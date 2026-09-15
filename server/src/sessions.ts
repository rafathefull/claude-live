import { EventEmitter } from 'node:events'
import { BACKFILL_LINES } from './config.js'
import {
  parseTranscriptPath,
  readAgentMeta,
  scanSubagents,
  scanTranscripts,
  type TranscriptRef,
} from './discover.js'
import { TranscriptParser, type SessionHints } from './parser.js'
import {
  RosterWatcher,
  projectNameOf,
  slugForCwd,
  transcriptPathFor,
  type RosterEntry,
} from './roster.js'
import { forEachLine } from './lines.js'
import { TaskTracker, mentionsTask, readOutputTail, type OutputTail } from './tasks.js'
import { TranscriptWatcher } from './watcher.js'
import type {
  ActorInfo,
  SessionInfo,
  TaskInfo,
  TimelineEvent,
  TokenUsage,
} from '../../shared/types.js'

/**
 * Une las tres fuentes en un solo estado vivo:
 *   1. el roster (~/.claude/sessions/<pid>.json) dice qué sesiones existen y si trabajan,
 *   2. los transcripts dicen qué hacen,
 *   3. los ficheros de subagentes dicen quién más habita cada sesión.
 */

/** Cuántos eventos recientes se guardan por sesión para los clientes que se conectan tarde. */
const RECENT_LIMIT = 400
/** Un subagente sin actividad durante este tiempo se considera terminado (heurística). */
const AGENT_IDLE_MS = 25_000
/** Una sesión muerta se retira del mundo tras este tiempo. */
const DEAD_GRACE_MS = 30_000

interface AgentState {
  info: ActorInfo
  parser: TranscriptParser
  path: string
  lastActivity: number
  done: boolean
}

interface SessionState {
  info: SessionInfo
  parser: TranscriptParser
  agents: Map<string, AgentState>
  /** toolUseId del `Agent` que lo lanzó → agentId. Es el enlace fiable padre → hijo. */
  agentByToolUse: Map<string, string>
  recent: TimelineEvent[]
  tokens: TokenUsage
  /** Shells y monitores en segundo plano de la sesión. */
  tasks: TaskTracker
  /** Emisión pendiente de `tasks`: un monitor parlanchín no debe repintar el panel por línea. */
  tasksTimer?: NodeJS.Timeout
  diedAt?: number
}

function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }
}

export class LiveRegistry extends EventEmitter {
  private sessions = new Map<string, SessionState>()
  private pathIndex = new Map<string, string>()
  private roster = new RosterWatcher()
  private watcher = new TranscriptWatcher()
  private sweeper?: NodeJS.Timeout

  async start(): Promise<void> {
    for (const file of await scanTranscripts()) {
      if (file.agentId === null) this.pathIndex.set(file.sessionId, file.path)
    }

    this.watcher.on('lines', ({ path, lines }) => void this.onLines(path, lines))
    this.watcher.on('warn', (msg: string) => this.emit('warn', msg))
    this.watcher.start()

    this.roster.on('change', (entries: RosterEntry[]) => void this.onRoster(entries))
    this.roster.start()

    this.sweeper = setInterval(() => this.sweep(), 5000)
    this.sweeper.unref?.()
  }

  stop(): void {
    this.roster.stop()
    this.watcher.stop()
    if (this.sweeper) clearInterval(this.sweeper)
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info)
  }

  listAgents(): ActorInfo[] {
    return [...this.sessions.values()].flatMap((s) => [...s.agents.values()].map((a) => a.info))
  }

  recentEvents(limit = 300): TimelineEvent[] {
    const all = [...this.sessions.values()].flatMap((s) => s.recent)
    all.sort((a, b) => a.ts.localeCompare(b.ts))
    return all.slice(-limit)
  }

  // ---------------------------------------------------------------- tareas

  /** Shells y monitores de todas las sesiones vivas, para el saludo. */
  listTasks(): TaskInfo[] {
    return [...this.sessions.values()].flatMap((s) => s.tasks.list())
  }

  tasksOf(sessionId: string): TaskInfo[] | null {
    return this.sessions.get(sessionId)?.tasks.list() ?? null
  }

  /** La cola del fichero de salida de una tarea, o null si la tarea no existe. */
  async taskOutput(sessionId: string, taskId: string, maxBytes: number): Promise<OutputTail | null> {
    const task = this.sessions.get(sessionId)?.tasks.get(taskId)
    if (!task?.outputPath) return null
    return readOutputTail(task.outputPath, maxBytes)
  }

  /**
   * Recorre el transcript completo parseando solo las líneas que pueden hablar de una tarea, que
   * son pocas: sale barato aun con conversaciones de megas. Lo que encuentra va al rastreador y al
   * parser en vivo, para que este sepa qué clase de tarea es la que se pare después.
   */
  private async scanTasks(state: SessionState, path: string): Promise<void> {
    const parser = new TranscriptParser({
      sessionId: state.info.sessionId,
      agentId: null,
      cwd: state.info.cwd,
    })
    try {
      await forEachLine(path, (line) => {
        if (!mentionsTask(line)) return
        for (const update of parser.parse(line).tasks) state.tasks.apply(update)
      })
    } catch {
      // el transcript todavía no existe: la sesión acaba de abrirse y no ha escrito nada
    }
    state.parser.rememberTasks(state.tasks.list())
  }

  private emitTasks(state: SessionState): void {
    if (state.tasksTimer) clearTimeout(state.tasksTimer)
    state.tasksTimer = setTimeout(() => {
      state.tasksTimer = undefined
      this.emit('tasks', { sessionId: state.info.sessionId, tasks: state.tasks.list() })
    }, 120)
  }

  /** Contrasta las tareas abiertas con sus procesos y ficheros de salida. Lo llama el barrido. */
  private async refreshTasks(): Promise<void> {
    for (const state of this.sessions.values()) {
      if (!state.tasks.hasOpen()) continue
      const live = state.info.live
      const changed = await state.tasks.refresh(live ? state.info.pid : undefined, {
        processStartedAt: live ? state.info.startedAt : undefined,
      })
      if (changed) this.emitTasks(state)
    }
  }

  // ---------------------------------------------------------------- roster

  private async onRoster(entries: RosterEntry[]): Promise<void> {
    const alive = new Set(entries.map((e) => e.sessionId))

    for (const entry of entries) {
      const existing = this.sessions.get(entry.sessionId)
      if (existing) {
        existing.info.status = entry.status ?? 'unknown'
        existing.info.pid = entry.pid
        existing.info.updatedAt = entry.updatedAt
        existing.info.live = true
        existing.diedAt = undefined
        continue
      }
      await this.adoptSession(entry)
    }

    for (const [sessionId, state] of this.sessions) {
      if (alive.has(sessionId) || !state.info.live) continue
      state.info.live = false
      state.info.status = 'dead'
      state.diedAt = Date.now()
      for (const agent of state.agents.values()) this.finishAgent(state, agent)
      // Sus shells y monitores mueren con ella: Claude Code los mata al salir.
      if (state.tasks.sessionDied()) this.emitTasks(state)
    }

    this.emit('sessions', this.listSessions())
  }

  private async adoptSession(entry: RosterEntry): Promise<void> {
    const path = this.pathIndex.get(entry.sessionId) ?? transcriptPathFor(entry)
    this.pathIndex.set(entry.sessionId, path)

    const info: SessionInfo = {
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      project: projectNameOf(entry.cwd),
      slug: slugForCwd(entry.cwd),
      transcriptPath: path,
      pid: entry.pid,
      name: entry.name,
      version: entry.version,
      kind: entry.kind,
      entrypoint: entry.entrypoint,
      status: entry.status ?? 'unknown',
      live: true,
      background: entry.background,
      startedAt: entry.startedAt,
      updatedAt: entry.updatedAt,
      tokens: emptyTokens(),
    }
    const state: SessionState = {
      info,
      parser: new TranscriptParser({ sessionId: entry.sessionId, agentId: null, cwd: entry.cwd }),
      agents: new Map(),
      agentByToolUse: new Map(),
      recent: [],
      tokens: emptyTokens(),
      tasks: new TaskTracker(entry.sessionId, info.slug),
    }
    this.sessions.set(entry.sessionId, state)

    // Las tareas se buscan en la conversación entera: un shell lanzado hace tres horas queda muy
    // por detrás de la cola que se lee a continuación, y sin esto no se vería hasta que dijera
    // algo. La cola no vuelve a aplicarlas, que los eventos de un monitor se contarían dos veces.
    await this.scanTasks(state, path)

    // Backfill: se leen las últimas líneas para que el mundo no arranque vacío, y a partir
    // de ahí el watcher sigue el fichero desde el final.
    const tail = await this.watcher.tail(path, BACKFILL_LINES)
    await this.watcher.prime(path)
    this.ingest(state, null, tail, { silent: true, skipTasks: true })

    for (const ref of await scanSubagents(entry.sessionId, info.slug)) {
      await this.adoptAgent(state, ref, { backfill: true })
    }

    // Las tareas que venían en la cola se contrastan ya con sus procesos: así el saludo no
    // dice «en marcha» de un monitor que murió con la sesión anterior.
    if (state.tasks.hasOpen()) {
      await state.tasks.refresh(entry.pid, { processStartedAt: entry.startedAt })
    }

    this.emit('event-batch', state.recent.slice(-BACKFILL_LINES))
    if (state.tasks.list().length > 0) this.emitTasks(state)
  }

  // ---------------------------------------------------------------- subagentes

  private async adoptAgent(
    state: SessionState,
    ref: TranscriptRef,
    opts: { backfill?: boolean } = {},
  ): Promise<AgentState> {
    const agentId = ref.agentId as string
    const existing = state.agents.get(agentId)
    const meta = await readAgentMeta(ref.path)

    if (existing) {
      // Ya se había anunciado por el `tool_result` de `Agent`, que no dice de qué tipo es.
      // Ahora que existe su .meta.json se completa y se vuelve a emitir, o se quedaría
      // como «agente» genérico en el mundo y en la timeline.
      const wasIncomplete = !existing.info.agentType
      if (meta.agentType) existing.info.agentType = meta.agentType
      if (meta.description && !existing.info.description) {
        existing.info.description = meta.description
      }
      if (meta.spawnDepth !== undefined) existing.info.depth = meta.spawnDepth
      if (meta.toolUseId) state.agentByToolUse.set(meta.toolUseId, agentId)
      if (wasIncomplete && meta.agentType) {
        // Con el tipo ya conocido se puede repartir el tono entre los hermanos.
        this.assignVariant(state, existing.info)
        this.emit('agent', { agent: existing.info, state: 'spawn' })
      }
      return existing
    }

    const info: ActorInfo = {
      id: agentId,
      sessionId: state.info.sessionId,
      kind: 'subagent',
      agentType: meta.agentType,
      description: meta.description,
      depth: meta.spawnDepth ?? 1,
      parentAgentId: null,
    }
    const agent: AgentState = {
      info,
      parser: new TranscriptParser({
        sessionId: state.info.sessionId,
        agentId,
        cwd: state.info.cwd,
        depth: info.depth,
      }),
      path: ref.path,
      lastActivity: Date.now(),
      done: false,
    }
    state.agents.set(agentId, agent)
    this.assignVariant(state, info)
    if (meta.toolUseId) state.agentByToolUse.set(meta.toolUseId, agentId)

    if (opts.backfill) {
      const tail = await this.watcher.tail(ref.path, BACKFILL_LINES)
      await this.watcher.prime(ref.path)
      this.ingest(state, agent, tail, { silent: true })
      // Un subagente ya presente al arrancar y sin actividad reciente ya había terminado.
      agent.done = true
      agent.info.done = true
      agent.info.kind = 'subagent'
    } else {
      this.emit('agent', { agent: info, state: 'spawn' })
      this.announceSpawnEvent(state, info)
    }
    return agent
  }

  /** Registra un subagente anunciado por el `tool_result` de `Agent` (aún sin fichero). */
  private announceAgent(
    state: SessionState,
    spawn: { agentId: string; description?: string; model?: string; toolUseId?: string },
  ): void {
    const existing = state.agents.get(spawn.agentId)
    if (existing) {
      if (spawn.description && !existing.info.description) {
        existing.info.description = spawn.description
      }
      return
    }
    const info: ActorInfo = {
      id: spawn.agentId,
      sessionId: state.info.sessionId,
      kind: 'subagent',
      description: spawn.description,
      depth: 1,
      parentAgentId: null,
    }
    state.agents.set(spawn.agentId, {
      info,
      parser: new TranscriptParser({
        sessionId: state.info.sessionId,
        agentId: spawn.agentId,
        cwd: state.info.cwd,
        depth: 1,
      }),
      path: '',
      lastActivity: Date.now(),
      done: false,
    })
    this.assignVariant(state, info)
    if (spawn.toolUseId) state.agentByToolUse.set(spawn.toolUseId, spawn.agentId)
    this.emit('agent', { agent: info, state: 'spawn' })
    this.announceSpawnEvent(state, info)
  }

  /**
   * Orden de este agente entre los hermanos de su mismo tipo, para que el mundo le dé un
   * tono propio. Dos `Explore` a la vez son indistinguibles si comparten color.
   */
  private assignVariant(state: SessionState, info: ActorInfo): void {
    let variant = 0
    for (const other of state.agents.values()) {
      if (other.info.id === info.id) continue
      if (other.info.agentType === info.agentType) variant++
    }
    info.variant = variant
  }

  /**
   * Evento de nacimiento. Va en la cola de Claude (agentId null) porque es él quien lanza al
   * subagente: así el mundo dibuja la línea de padre a hijo y anuncia su cometido.
   */
  private announceSpawnEvent(state: SessionState, info: ActorInfo): void {
    this.push(state, {
      uuid: `${info.id}:spawn`,
      parentUuid: null,
      sessionId: state.info.sessionId,
      agentId: null,
      ts: new Date().toISOString(),
      kind: 'agent_spawn',
      station: 'desk',
      summary: `${info.agentType ?? 'agente'}: ${info.description ?? 'arranca'}`,
      stat: {
        kind: 'agentState',
        agentType: info.agentType ?? 'agent',
        started: true,
      },
      actor: info,
    })
  }

  private finishAgent(state: SessionState, agent: AgentState): void {
    if (agent.done) return
    agent.done = true
    agent.info.done = true
    this.emit('agent', { agent: agent.info, state: 'done' })
    this.push(state, {
      uuid: `${agent.info.id}:done`,
      parentUuid: null,
      sessionId: state.info.sessionId,
      agentId: agent.info.id,
      ts: new Date().toISOString(),
      kind: 'agent_done',
      station: 'desk',
      summary: `${agent.info.agentType ?? 'agente'} terminó`,
      stat: {
        kind: 'agentState',
        agentType: agent.info.agentType ?? 'agent',
        started: false,
      },
      actor: agent.info,
    })
  }

  // ---------------------------------------------------------------- transcripts

  private async onLines(path: string, lines: string[]): Promise<void> {
    const ref = parseTranscriptPath(path)
    if (!ref) return

    let state = this.sessions.get(ref.sessionId)
    if (!state) {
      // Transcript de una sesión que el roster todavía no ha publicado (o histórica que
      // alguien está reproduciendo): se ignora hasta que el roster la anuncie.
      if (ref.agentId === null) this.pathIndex.set(ref.sessionId, path)
      return
    }

    if (ref.agentId === null) {
      this.ingest(state, null, lines)
      return
    }
    const agent = await this.adoptAgent(state, ref)
    agent.lastActivity = Date.now()
    if (agent.done) {
      // Revivió: había pasado el umbral de inactividad pero sigue trabajando.
      agent.done = false
      agent.info.done = false
      this.emit('agent', { agent: agent.info, state: 'spawn' })
    }
    if (!agent.path) agent.path = path
    this.ingest(state, agent, lines)
  }

  private ingest(
    state: SessionState,
    agent: AgentState | null,
    lines: string[],
    opts: { silent?: boolean; skipTasks?: boolean } = {},
  ): void {
    const parser = agent ? agent.parser : state.parser
    let tasksChanged = false
    for (const line of lines) {
      const result = parser.parse(line)
      this.applyHints(state, result.hints)

      for (const spawn of result.spawned) this.announceAgent(state, spawn)
      for (const toolUseId of result.finished) {
        const agentId = state.agentByToolUse.get(toolUseId)
        const target = agentId ? state.agents.get(agentId) : undefined
        if (target) this.finishAgent(state, target)
      }
      // Las tareas de un subagente son de la sesión igual: comparten pid y directorio de salida.
      if (!opts.skipTasks) {
        for (const update of result.tasks) {
          if (state.tasks.apply(update)) tasksChanged = true
        }
      }

      for (const event of result.events) {
        if (agent) event.actor = agent.info
        this.push(state, event, opts.silent)
      }
    }
    if (tasksChanged && !opts.silent) this.emitTasks(state)
  }

  private applyHints(state: SessionState, hints: SessionHints): void {
    const info = state.info
    if (hints.aiTitle) info.aiTitle = hints.aiTitle
    if (hints.gitBranch) info.gitBranch = hints.gitBranch
    if (hints.model) info.model = hints.model
    if (hints.permissionMode) info.permissionMode = hints.permissionMode
    if (hints.mode) info.mode = hints.mode
    if (hints.lastTs) info.lastTs = hints.lastTs
    if (!info.firstTs && hints.lastTs) info.firstTs = hints.lastTs
    if (hints.lastContextTokens) info.lastContextTokens = hints.lastContextTokens
    if (hints.tokens) {
      state.tokens.input += hints.tokens.input
      state.tokens.output += hints.tokens.output
      state.tokens.cacheRead += hints.tokens.cacheRead
      state.tokens.cacheCreate += hints.tokens.cacheCreate
      info.tokens = { ...state.tokens }
    }
  }

  private push(state: SessionState, event: TimelineEvent, silent = false): void {
    state.recent.push(event)
    if (state.recent.length > RECENT_LIMIT) state.recent.shift()
    state.info.eventCount = (state.info.eventCount ?? 0) + 1
    if (!silent) this.emit('event', event)
  }

  // ---------------------------------------------------------------- hooks

  /**
   * Lo que cuentan los hooks de Claude Code sobre un subagente. `SubagentStop` es la única
   * señal exacta de que ha terminado: sin hooks hay que deducirlo por inactividad.
   */
  noteAgentFromHook(sessionId: string, agentId: string, event: 'start' | 'stop'): void {
    const state = this.sessions.get(sessionId)
    const agent = state?.agents.get(agentId)
    if (!state || !agent) return
    if (event === 'stop') {
      this.finishAgent(state, agent)
      return
    }
    agent.lastActivity = Date.now()
    agent.done = false
  }

  /** Marca actividad en una sesión para que el barrido no dé por muertos a sus agentes. */
  noteActivityFromHook(sessionId: string, agentId: string | null): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const agent = agentId ? state.agents.get(agentId) : undefined
    if (agent) agent.lastActivity = Date.now()
  }

  // ---------------------------------------------------------------- limpieza

  private sweep(): void {
    const now = Date.now()
    let sessionsChanged = false
    void this.refreshTasks()

    for (const [sessionId, state] of this.sessions) {
      for (const agent of state.agents.values()) {
        if (!agent.done && now - agent.lastActivity > AGENT_IDLE_MS) {
          this.finishAgent(state, agent)
        }
      }
      if (state.diedAt && now - state.diedAt > DEAD_GRACE_MS) {
        this.sessions.delete(sessionId)
        if (state.tasksTimer) clearTimeout(state.tasksTimer)
        this.watcher.forget(state.info.transcriptPath)
        for (const agent of state.agents.values()) {
          if (agent.path) this.watcher.forget(agent.path)
        }
        sessionsChanged = true
      }
    }

    if (sessionsChanged) this.emit('sessions', this.listSessions())
  }
}
