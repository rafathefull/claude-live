import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { HOST, PORT, WEB_DIST } from './config.js'
import { listHistory, readRawEvent, readSessionEvents } from './history.js'
import { normalizeHook, type HookPayload } from './hooks.js'
import { LiveRegistry } from './sessions.js'
import type { ActorInfo, ServerMessage, TimelineEvent } from '../../shared/types.js'

const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 })
const registry = new LiveRegistry()

/** Clientes SSE conectados. */
const clients = new Set<{ write: (chunk: string) => void }>()

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
registry.on('agent', ({ agent, state }: { agent: ActorInfo; state: 'spawn' | 'done' }) =>
  broadcast({ type: 'agent', agent, state }),
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

app.get('/api/sessions/:id/events', async (request) => {
  const { id } = request.params as { id: string }
  const query = request.query as { from?: string; limit?: string; agents?: string }
  return readSessionEvents(id, {
    from: query.from ? Number(query.from) : 0,
    limit: query.limit ? Number(query.limit) : 500,
    includeAgents: query.agents !== '0',
  })
})

app.get('/api/sessions/:id/raw/:uuid', async (request, reply) => {
  const { id, uuid } = request.params as { id: string; uuid: string }
  const raw = await readRawEvent(id, uuid)
  if (raw === null) return reply.code(404).send({ error: 'evento no encontrado' })
  return raw
})

app.post('/hook', async (request, reply) => {
  const { events, agents } = normalizeHook((request.body ?? {}) as HookPayload)
  for (const event of events) broadcast({ type: 'event', event })
  for (const { agent, state } of agents) broadcast({ type: 'agent', agent, state })
  // Nunca bloquear a Claude Code: se contesta vacío y en éxito siempre.
  return reply.code(200).send({})
})

app.get('/api/health', async () => ({
  ok: true,
  sessions: registry.listSessions().length,
  clients: clients.size,
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
