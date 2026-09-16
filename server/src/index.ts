import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { HOST, PORT, WEB_DIST } from './config.js'
import { listHistory, readRawEvent, readSessionEvents } from './history.js'
import { normalizeHook, type HookPayload } from './hooks.js'
import { JobsWatcher, readJobs } from './jobs.js'
import { computeMetrics } from './metrics.js'
import { retentionInfo } from './retention.js'
import { LiveRegistry } from './sessions.js'
import { sessionTiming } from './timing.js'
import { DEFAULT_PAUSE_MS } from '../../shared/timing.js'
import type {
  ActorInfo,
  JobInfo,
  ServerMessage,
  TaskInfo,
  TimelineEvent,
} from '../../shared/types.js'

/** Tope de lo que se devuelve de la salida de una tarea: hay salidas de megas. */
const MAX_OUTPUT_TAIL = 256 * 1024
const DEFAULT_OUTPUT_TAIL = 64 * 1024

const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 })
const registry = new LiveRegistry()

/** Clientes SSE conectados. */
const clients = new Set<{ write: (chunk: string) => void }>()
/** Cuántos hooks se han recibido, por evento: sirve para comprobar que están configurados. */
const hookCounts = new Map<string, number>()

function broadcast(message: ServerMessage): void {
  const payload = `data: ${JSON.stringify(message)}\n\n`
  for (const client of clients) {
    try {
      client.write(payload)
    } catch {
      clients.delete(client)
    }
  }
}

registry.on('event', (event: TimelineEvent) => broadcast({ type: 'event', event }))
registry.on('event-batch', (events: TimelineEvent[]) => {
  for (const event of events) broadcast({ type: 'event', event })
})
registry.on('sessions', () => broadcast({ type: 'sessions', sessions: registry.listSessions() }))

/**
 * Jobs en segundo plano. Se guarda la última lectura para poder incluirlos en el saludo: al
 * reconectar, el mundo tiene que volver a poblarse con los que ya había.
 */
let jobs: JobInfo[] = []
const jobsWatcher = new JobsWatcher()
jobsWatcher.on('change', (next: JobInfo[]) => {
  jobs = next
  broadcast({ type: 'jobs', jobs })
})
registry.on('agent', ({ agent, state }: { agent: ActorInfo; state: 'spawn' | 'done' }) =>
  broadcast({ type: 'agent', agent, state }),
)
registry.on('tasks', ({ sessionId, tasks }: { sessionId: string; tasks: TaskInfo[] }) =>
  broadcast({ type: 'tasks', sessionId, tasks }),
)
registry.on('warn', (msg: string) => console.warn(`[claude-live] ${msg}`))

app.get('/api/stream', (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const client = { write: (chunk: string) => reply.raw.write(chunk) }
  clients.add(client)

  const hello: ServerMessage = {
    type: 'hello',
    sessions: registry.listSessions(),
    agents: registry.listAgents(),
    jobs,
    tasks: registry.listTasks(),
  }
  client.write(`data: ${JSON.stringify(hello)}\n\n`)
  for (const event of registry.recentEvents()) {
    client.write(`data: ${JSON.stringify({ type: 'event', event } satisfies ServerMessage)}\n\n`)
  }

  const heartbeat = setInterval(() => {
    try {
      reply.raw.write(': ping\n\n')
    } catch {
      clearInterval(heartbeat)
    }
  }, 25_000)
  heartbeat.unref?.()

  request.raw.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(client)
  })
})

app.get('/api/sessions', async (request) => {
  const query = request.query as { active?: string }
  const live = registry.listSessions()
  if (query.active === '1' || query.active === 'true') return { sessions: live }
  const history = await listHistory()
  const liveIds = new Set(live.map((s) => s.sessionId))
  return { sessions: [...live, ...history.filter((h) => !liveIds.has(h.sessionId))] }
})

/**
 * Cuánta historia sobrevive. Claude Code borra los transcripts pasados `cleanupPeriodDays`, y
 * conviene que quien mire el historial sepa que lo que ve no es todo lo que hizo.
 */
app.get('/api/retention', async () => retentionInfo())

/** Jobs en segundo plano, vivos y terminados. Se lee en el momento: son cinco ficheros. */
app.get('/api/jobs', async () => ({ jobs: await readJobs() }))

/**
 * Métricas agregadas por proyecto y día. La primera vez recorre todos los transcripts; después
 * solo los que hayan cambiado. `?force=1` obliga a recalcular todo.
 */
app.get('/api/metrics', async (request) => {
  const query = request.query as { force?: string }
  return computeMetrics({ force: query.force === '1' })
})

app.get('/api/sessions/:id/events', async (request) => {
  const { id } = request.params as { id: string }
  const query = request.query as { from?: string; limit?: string; agents?: string }
  return readSessionEvents(id, {
    from: query.from ? Number(query.from) : 0,
    limit: query.limit ? Number(query.limit) : 500,
    includeAgents: query.agents !== '0',
  })
})

/**
 * En qué se va el tiempo de una sesión, viva o histórica, sobre su transcript completo. `pause`
 * son los minutos sin actividad a partir de los cuales un hueco se aparta como pausa (30 por
 * omisión).
 */
app.get('/api/sessions/:id/time', async (request, reply) => {
  const { id } = request.params as { id: string }
  const query = request.query as { pause?: string }
  const minutes = query.pause ? Number(query.pause) : NaN
  const pauseMs =
    Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60_000) : DEFAULT_PAUSE_MS
  const report = await sessionTiming(id, pauseMs)
  if (report === null) return reply.code(404).send({ error: 'sesión no encontrada' })
  return report
})

/** Shells y monitores en segundo plano de una sesión viva. */
app.get('/api/sessions/:id/tasks', async (request, reply) => {
  const { id } = request.params as { id: string }
  const tasks = registry.tasksOf(id)
  if (tasks === null) return reply.code(404).send({ error: 'sesión no encontrada' })
  return { tasks }
})

/**
 * La cola del fichero de salida de una tarea. Se sirve desde aquí porque vive en /tmp, fuera
 * del alcance del navegador. `tail` son bytes, con un tope para las salidas de megas.
 */
app.get('/api/sessions/:id/tasks/:taskId/output', async (request, reply) => {
  const { id, taskId } = request.params as { id: string; taskId: string }
  const query = request.query as { tail?: string }
  const wanted = query.tail ? Number(query.tail) : DEFAULT_OUTPUT_TAIL
  const tail = Number.isFinite(wanted) && wanted > 0 ? Math.min(wanted, MAX_OUTPUT_TAIL) : DEFAULT_OUTPUT_TAIL
  const output = await registry.taskOutput(id, taskId, tail)
  if (output === null) return reply.code(404).send({ error: 'tarea no encontrada' })
  return output
})

app.get('/api/sessions/:id/raw/:uuid', async (request, reply) => {
  const { id, uuid } = request.params as { id: string; uuid: string }
  const raw = await readRawEvent(id, uuid)
  if (raw === null) return reply.code(404).send({ error: 'evento no encontrado' })
  return raw
})

app.post('/hook', async (request, reply) => {
  const payload = (request.body ?? {}) as HookPayload
  const name = payload.hook_event_name ?? 'desconocido'
  hookCounts.set(name, (hookCounts.get(name) ?? 0) + 1)
  const { events, agents } = normalizeHook(payload)

  // El registry también se entera: `SubagentStop` es la única señal exacta de que un
  // subagente ha terminado (sin hooks se deduce por inactividad).
  if (payload.session_id) {
    for (const { agent, state } of agents) {
      registry.noteAgentFromHook(payload.session_id, agent.id, state === 'spawn' ? 'start' : 'stop')
    }
    if (agents.length === 0) {
      registry.noteActivityFromHook(payload.session_id, payload.agent_id ?? null)
    }
  }

  for (const event of events) broadcast({ type: 'event', event })
  for (const { agent, state } of agents) broadcast({ type: 'agent', agent, state })
  // Nunca bloquear a Claude Code: se contesta vacío y en éxito siempre.
  return reply.code(200).send({})
})

app.get('/api/health', async () => ({
  ok: true,
  sessions: registry.listSessions().length,
  clients: clients.size,
  hooks: Object.fromEntries(hookCounts),
}))

const distDir = fileURLToPath(WEB_DIST)
if (existsSync(distDir)) {
  const { default: fastifyStatic } = await import('@fastify/static')
  await app.register(fastifyStatic, { root: distDir })
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api') || request.url.startsWith('/hook')) {
      return reply.code(404).send({ error: 'no encontrado' })
    }
    return reply.sendFile('index.html')
  })
}

await registry.start()
jobsWatcher.start()
await app.listen({ host: HOST, port: PORT })
console.log(`[claude-live] escuchando en http://${HOST}:${PORT}`)
if (!existsSync(distDir)) {
  console.log('[claude-live] front en desarrollo: http://127.0.0.1:5173')
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    registry.stop()
    void app.close().then(() => process.exit(0))
  })
}
