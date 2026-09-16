import { MAX_PAYLOAD_BYTES, MAX_SUMMARY_CHARS } from './config.js'
import {
  parseTaskNotifications,
  updateFromNotification,
  updateFromToolResult,
  type TaskUpdate,
} from './tasks.js'
import { mcpServerOf, stationForTool } from '../../shared/mapping.js'
import type { EventKind, Stat, TaskKind, TimelineEvent, TokenUsage } from '../../shared/types.js'

/**
 * Traduce las líneas crudas de un transcript de Claude Code a eventos del mundo.
 *
 * Reglas de oro:
 *  - tolerante: un tipo desconocido o un campo ausente nunca lanza; devuelve [].
 *  - barato: no serializa payloads gigantes (hay líneas de +700 KB en transcripts reales).
 *  - con estado mínimo: solo la tabla de tool_use pendientes, para calcular duraciones.
 */

export interface ParseContext {
  sessionId: string
  /** null = sesión principal; si no, el id del subagente dueño del fichero. */
  agentId: string | null
  cwd?: string
  /** Profundidad del actor (0 = principal). */
  depth?: number
}

/** Datos de sesión que solo aparecen dentro del transcript. */
export interface SessionHints {
  aiTitle?: string
  gitBranch?: string
  model?: string
  permissionMode?: string
  mode?: string
  cwd?: string
  lastTs?: string
  firstTs?: string
  tokens?: TokenUsage
  lastContextTokens?: number
}

export interface ParseResult {
  events: TimelineEvent[]
  hints: SessionHints
  /** Subagentes lanzados en esta línea (el tool_result de `Agent` trae el agentId). */
  spawned: { agentId: string; description?: string; model?: string; toolUseId?: string }[]
  /** toolUseId de subagentes que han terminado (tool_result no asíncrono). */
  finished: string[]
  /** Shells y monitores en segundo plano: nacen, emiten, acaban (ver tasks.ts). */
  tasks: TaskUpdate[]
}

const EMPTY: ParseResult = { events: [], hints: {}, spawned: [], finished: [], tasks: [] }

/** Cuántas notificaciones encoladas y aún no entregadas se recuerdan como mucho. */
const NOTIFICATIONS_REMEMBERED = 400

function clip(text: string, max = MAX_SUMMARY_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Trunca el payload garantizando el límite *sobre la forma serializada*: recortar el JSON
 * y devolverlo como string no basta, porque al volver a serializarlo los escapes lo hacen
 * crecer otra vez (en transcripts reales, un recorte de 8 KB volvía a 9,9 KB).
 */
function safePayload(value: unknown): { payload: unknown; truncated: boolean } {
  if (value === undefined || value === null) return { payload: undefined, truncated: false }
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    return { payload: '[no serializable]', truncated: true }
  }
  if (json === undefined) return { payload: undefined, truncated: false }
  if (json.length <= MAX_PAYLOAD_BYTES) return { payload: value, truncated: false }

  let preview = json.slice(0, MAX_PAYLOAD_BYTES)
  let serialized = JSON.stringify(preview)
  while (serialized.length > MAX_PAYLOAD_BYTES && preview.length > 256) {
    preview = preview.slice(0, Math.floor(preview.length * 0.8))
    serialized = JSON.stringify(preview)
  }
  return { payload: `${preview}…`, truncated: true }
}

function relPath(path: string, cwd?: string): string {
  if (cwd && path.startsWith(cwd)) {
    const rest = path.slice(cwd.length).replace(/^\//, '')
    return rest || path
  }
  return path.replace(/^\/home\/[^/]+\//, '~/')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Texto de un content block que puede ser string o array de bloques. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const b = asRecord(block)
    if (typeof b.text === 'string') parts.push(b.text)
    else if (typeof b.thinking === 'string') parts.push(b.thinking)
  }
  return parts.join(' ')
}

/** Resumen de una línea para la entrada de una herramienta. */
export function describeToolInput(
  tool: string,
  input: unknown,
  cwd?: string,
): { summary: string; stat?: Stat } {
  const i = asRecord(input)
  if (tool === 'TaskUpdate' && !str(i.status)) {
    const id = String(i.taskId ?? '?')
    return { summary: `#${id} → actualizada`, stat: { kind: 'taskUpdated', id } }
  }
  if (tool === 'AskUserQuestion') {
    const questions = Array.isArray(i.questions) ? i.questions : []
    const first = asRecord(questions[0])
    const asked = str(first.question)
    if (!asked) {
      return { summary: `${questions.length} pregunta(s)`, stat: { kind: 'questions', n: questions.length } }
    }
  }
  return { summary: summarizeToolInput(tool, input, cwd) }
}

export function summarizeToolInput(tool: string, input: unknown, cwd?: string): string {
  const i = asRecord(input)
  switch (tool) {
    case 'Bash':
    case 'BashOutput':
      return clip(str(i.command) ?? str(i.description) ?? '')
    case 'Read':
    case 'Write':
      return clip(relPath(str(i.file_path) ?? '', cwd))
    case 'Edit': {
      const path = relPath(str(i.file_path) ?? '', cwd)
      const old = str(i.old_string) ?? ''
      return clip(`${path} · «${clip(old, 40)}»`)
    }
    case 'Grep':
      return clip(`«${str(i.pattern) ?? ''}» en ${relPath(str(i.path) ?? '.', cwd)}`)
    case 'Glob':
      return clip(str(i.pattern) ?? '')
    case 'ToolSearch':
      return clip(str(i.query) ?? '')
    case 'Skill':
      return clip(`${str(i.skill) ?? '?'}${i.args ? ` — ${clip(String(i.args), 90)}` : ''}`)
    case 'Agent':
      return clip(`${str(i.subagent_type) ?? 'agente'}: ${str(i.description) ?? ''}`)
    case 'TaskCreate':
      return clip(str(i.subject) ?? '')
    case 'TaskUpdate':
      return clip(`#${String(i.taskId ?? '?')} → ${str(i.status) ?? 'actualizada'}`)
    case 'WebFetch':
      return clip(str(i.url) ?? '')
    case 'WebSearch':
      return clip(str(i.query) ?? '')
    case 'AskUserQuestion': {
      const qs = Array.isArray(i.questions) ? i.questions : []
      const first = asRecord(qs[0])
      return clip(str(first.question) ?? `${qs.length} pregunta(s)`)
    }
    case 'Artifact':
      return clip(str(i.file_path) ?? str(i.action) ?? '')
    default: {
      const server = mcpServerOf(tool)
      if (server) {
        const toolName = tool.slice(`mcp__${server}__`.length)
        const keys = Object.keys(i).slice(0, 3).join(', ')
        return clip(`${server} · ${toolName}${keys ? ` (${keys})` : ''}`)
      }
      const json = clip(JSON.stringify(i) ?? '', 120)
      return json === '{}' ? '' : json
    }
  }
}

/**
 * Describe el resultado de una herramienta: una línea de texto y, cuando el resumen incluye
 * palabras traducibles, el dato en crudo para que el front lo formatee en su idioma.
 */
export function describeToolResult(
  tool: string | undefined,
  result: unknown,
): { summary: string; stat?: Stat } {
  if (result === undefined || result === null) return { summary: '' }
  if (typeof result === 'string') return { summary: clip(result, 120) }
  const r = asRecord(result)

  // Un `Bash` con run_in_background contesta al instante con stdout vacío y el id de la tarea:
  // decir «sin salida» sería engañar, porque el comando sigue corriendo. Va antes que el stdout.
  const shellId = str(r.backgroundTaskId)
  if (shellId) {
    return {
      summary: `shell en segundo plano (${shellId})`,
      stat: { kind: 'taskStarted', id: shellId, task: 'shell' },
    }
  }
  // Un monitor devuelve `{ taskId, timeoutMs, persistent }`; `timeoutMs` no lo trae nadie más.
  const monitorId = str(r.taskId)
  if (monitorId && (tool === 'Monitor' || typeof r.timeoutMs === 'number')) {
    return {
      summary: `monitor armado (${monitorId})`,
      stat: { kind: 'taskStarted', id: monitorId, task: 'monitor' },
    }
  }
  // `TaskStop` sobre un shell o un monitor. Aquí no se sabe cuál de los dos era: el parser lo
  // afina si vio nacer la tarea.
  const stoppedId = str(r.task_id)
  if (stoppedId && str(r.task_type) === 'local_bash') {
    return {
      summary: `tarea parada (${stoppedId})`,
      stat: { kind: 'taskEnded', id: stoppedId, task: 'shell', status: 'stopped' },
    }
  }

  if (typeof r.stdout === 'string' || typeof r.stderr === 'string') {
    const stdout = (str(r.stdout) ?? '').trim()
    const stderr = (str(r.stderr) ?? '').trim()
    if (stderr && !stdout) {
      return { summary: clip(`stderr: ${stderr}`, 120), stat: { kind: 'stderr', text: clip(stderr, 110) } }
    }
    if (!stdout) return { summary: 'sin salida', stat: { kind: 'empty' } }
    const lines = stdout.split('\n')
    const head = clip(lines[0], 110)
    const extra = lines.length - 1
    return {
      summary: clip(`${head}${extra > 0 ? ` (+${extra} líneas)` : ''}`, 120),
      stat: { kind: 'stdout', head, extra },
    }
  }

  if (Array.isArray(r.structuredPatch)) {
    let added = 0
    let removed = 0
    for (const hunk of r.structuredPatch) {
      for (const line of (asRecord(hunk).lines as string[] | undefined) ?? []) {
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
    }
    return { summary: `+${added} / −${removed}`, stat: { kind: 'diff', added, removed } }
  }

  // AskUserQuestion: interesa lo que respondió el usuario, no el JSON de las preguntas.
  if (r.answers && typeof r.answers === 'object') {
    const chosen = Object.values(r.answers as Record<string, unknown>)
      .filter((value): value is string => typeof value === 'string')
      .join(' · ')
    if (chosen) {
      return { summary: clip(`elegido: ${chosen}`, 120), stat: { kind: 'chosen', value: clip(chosen, 100) } }
    }
  }

  if (Array.isArray(r.matches)) {
    return { summary: `${r.matches.length} coincidencia(s)`, stat: { kind: 'matches', n: r.matches.length } }
  }
  if (typeof r.numFiles === 'number') {
    return { summary: `${r.numFiles} fichero(s)`, stat: { kind: 'files', n: r.numFiles } }
  }
  if (typeof r.numLines === 'number') {
    return { summary: `${r.numLines} línea(s)`, stat: { kind: 'lines', n: r.numLines } }
  }
  // Read devuelve el fichero anidado: {type:'text', file:{numLines, totalLines, …}}
  const file = asRecord(r.file)
  if (typeof file.numLines === 'number') {
    const total = typeof file.totalLines === 'number' ? file.totalLines : undefined
    return {
      summary: `${file.numLines} línea(s)${total ? ` de ${total}` : ''}`,
      stat: { kind: 'lines', n: file.numLines, total },
    }
  }
  if (str(r.status) === 'async_launched') {
    const id = str(r.agentId) ?? '?'
    return { summary: `lanzado (${id})`, stat: { kind: 'launched', id } }
  }
  if (Array.isArray(r.tasks)) {
    return { summary: `${r.tasks.length} tarea(s)`, stat: { kind: 'tasks', n: r.tasks.length } }
  }
  if (typeof r.type === 'string' && typeof r.filePath === 'string') {
    const path = relPath(r.filePath)
    return { summary: clip(`${r.type} ${path}`), stat: { kind: 'fileOp', op: r.type, path } }
  }

  const text = textOf(r.content)
  if (text) return { summary: clip(text, 120) }
  return { summary: clip(JSON.stringify(r) ?? '', 120) }
}

/** Compatibilidad: el resumen a secas, en castellano. */
export function summarizeToolResult(tool: string | undefined, result: unknown): string {
  return describeToolResult(tool, result).summary
}

function usageOf(message: Record<string, unknown>): TokenUsage | undefined {
  const u = asRecord(message.usage)
  if (Object.keys(u).length === 0) return undefined
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheCreate: num(u.cache_creation_input_tokens),
  }
}

export class TranscriptParser {
  /**
   * toolUseId → instante, nombre y entrada, para calcular la duración al llegar el resultado y
   * saber qué comando lanzó un shell en segundo plano (el resultado solo trae el id).
   */
  private pending = new Map<string, { ts: number; tool: string; input?: unknown }>()
  private counter = 0
  /**
   * Notificación → cuántas veces se ha visto encolada sin verla entregada todavía.
   *
   * La misma `<task-notification>` aparece dos veces en el transcript: en una línea
   * `queue-operation` cuando ocurre y en una línea `user` cuando se le entrega al modelo, que
   * puede ser mucho después si Claude estaba ocupado con una herramienta larga. No vale una
   * ventana de tiempo: se empareja cada entrega con su encolado pendiente, y así dos eventos
   * iguales de un monitor (encolados los dos) siguen siendo dos.
   */
  private pendingDelivery = new Map<string, number>()
  /** Tareas que se han visto nacer, para saber si lo que se para es un shell o un monitor. */
  private taskKinds = new Map<string, TaskKind>()
  /**
   * Último `message.id` visto. Cada bloque de una respuesta va en su propia línea y todas repiten
   * el mismo `usage`: los tokens se cuentan en la primera y ya, o salen multiplicados por bloques.
   */
  private lastMessageId?: string
  /**
   * Hora del último bloque de respuesta. Las herramientas arrancan cuando la respuesta termina,
   * no cuando se escribió su bloque: una llamada en paralelo con tres detrás «duraba» también lo
   * que tardaron en generarse esas tres.
   */
  private lastAssistantTs = 0

  constructor(private ctx: ParseContext) {}

  updateContext(patch: Partial<ParseContext>): void {
    this.ctx = { ...this.ctx, ...patch }
  }

  /**
   * Tareas que otro parser vio nacer (el que recorre la conversación entera al adoptar una
   * sesión): así este sabe si lo que se para después es un shell o un monitor.
   */
  rememberTasks(tasks: readonly { id: string; kind: TaskKind }[]): void {
    for (const task of tasks) this.taskKinds.set(task.id, task.kind)
  }

  /**
   * Las `<task-notification>` de un texto → actualizaciones de tareas y eventos de la timeline.
   * Solo las de shells y monitores: las de subagentes ya tienen su ciclo de vida en el mundo.
   */
  private notifications(
    source: string,
    ts: string,
    base: Pick<TimelineEvent, 'parentUuid' | 'sessionId' | 'agentId' | 'ts'>,
    uuid: string,
    events: TimelineEvent[],
    tasks: TaskUpdate[],
    origin: 'queued' | 'delivered',
  ): void {
    for (const [index, n] of parseTaskNotifications(source).entries()) {
      const key = `${n.id}|${n.status ?? ''}|${n.event ?? n.summary ?? ''}`
      const pending = this.pendingDelivery.get(key) ?? 0
      if (origin === 'queued') {
        this.pendingDelivery.set(key, pending + 1)
        if (this.pendingDelivery.size > NOTIFICATIONS_REMEMBERED) {
          const oldest = this.pendingDelivery.keys().next().value
          if (oldest !== undefined) this.pendingDelivery.delete(oldest)
        }
      } else if (pending > 0) {
        // Ya se contó cuando se encoló: esta es su entrega.
        if (pending === 1) this.pendingDelivery.delete(key)
        else this.pendingDelivery.set(key, pending - 1)
        continue
      }
      // Entregada sin haberse visto encolada (versiones antiguas, o el encolado quedó fuera del
      // tramo leído): cuenta una vez.

      const update = updateFromNotification(n, ts)
      if (!update) continue
      if (update.action === 'end' && !update.kind) update.kind = this.taskKinds.get(n.id)
      tasks.push(update)

      const { payload, truncated } = safePayload(n.raw)
      const evUuid = `${uuid}:task:${index}`
      if (update.action === 'event') {
        events.push({
          ...base,
          uuid: evUuid,
          kind: 'task_event',
          tool: 'Monitor',
          station: 'terminal',
          summary: clip(`monitor: ${update.text}`),
          stat: { kind: 'monitorEvent', id: n.id, text: clip(update.text, 110) },
          payload,
          truncated,
        })
      } else if (update.action === 'end') {
        const task = update.kind ?? this.taskKinds.get(n.id) ?? 'shell'
        // Si el fin vino como «evento» de control ([Monitor expired…]), ese texto es el resumen.
        const said = n.event?.replace(/^\[|\]$/g, '') ?? n.summary
        events.push({
          ...base,
          uuid: evUuid,
          kind: 'task_event',
          tool: task === 'monitor' ? 'Monitor' : 'Bash',
          station: 'terminal',
          summary: clip(said ?? `${task} ${update.status}`),
          stat: {
            kind: 'taskEnded',
            id: n.id,
            task,
            status: update.status,
            exitCode: update.exitCode,
          },
          payload,
          truncated,
        })
      }
    }
  }

  /** Convierte una línea del transcript en 0..n eventos del mundo. */
  parse(line: string): ParseResult {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '{') return EMPTY

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return EMPTY // línea a medio escribir o corrupta: se descarta sin ruido
    }

    const type = str(raw.type)
    const hints: SessionHints = {}
    const events: TimelineEvent[] = []
    const spawned: ParseResult['spawned'] = []
    const finished: string[] = []
    const tasks: TaskUpdate[] = []
    const ts = str(raw.timestamp) ?? new Date().toISOString()

    if (str(raw.cwd)) hints.cwd = str(raw.cwd)
    if (str(raw.gitBranch)) hints.gitBranch = str(raw.gitBranch)
    if (str(raw.timestamp)) hints.lastTs = ts

    const base = {
      sessionId: this.ctx.sessionId,
      agentId: this.ctx.agentId,
      parentUuid: str(raw.parentUuid) ?? null,
      ts,
    }
    const uuid = str(raw.uuid) ?? `${this.ctx.sessionId}:${this.counter++}`

    switch (type) {
      case 'ai-title':
        hints.aiTitle = str(raw.aiTitle)
        return { events, hints, spawned, finished, tasks }
      case 'mode':
        hints.mode = str(raw.mode)
        return { events, hints, spawned, finished, tasks }
      case 'permission-mode':
        hints.permissionMode = str(raw.permissionMode)
        return { events, hints, spawned, finished, tasks }
      case 'queue-operation': {
        // Lo que se encola para el siguiente turno. Casi todo es ruido, salvo los avisos de los
        // shells y monitores en segundo plano. Cada aviso pasa por aquí dos veces, `enqueue` al
        // llegar y `remove` al retirarlo de la cola, con el mismo texto: solo cuenta la primera.
        const content = str(raw.content) ?? ''
        if (str(raw.operation) === 'enqueue' && content.includes('<task-notification>')) {
          this.notifications(content, ts, base, uuid, events, tasks, 'queued')
        }
        return { events, hints, spawned, finished, tasks }
      }
      case 'attachment':
      case 'file-history-snapshot':
      case 'file-history-delta':
      case 'last-prompt':
      case 'system':
        // Ruido de mantenimiento: no habita el mundo.
        return { events, hints, spawned, finished, tasks }
      default:
        break
    }

    const message = asRecord(raw.message)

    if (type === 'user') {
      const content = message.content
      const blocks = Array.isArray(content) ? content : []
      const toolResults = blocks.filter((b) => str(asRecord(b).type) === 'tool_result')
      const text = textOf(content)

      // Aviso de un shell o monitor entregado a Claude. Suele venir solo, pero también puede
      // acompañar a un tool_result, así que se mira antes de decidir qué es la línea.
      if (text.includes('<task-notification>')) {
        this.notifications(text, ts, base, uuid, events, tasks, 'delivered')
      }

      if (toolResults.length > 0 || raw.toolUseResult !== undefined) {
        for (const block of toolResults.length > 0 ? toolResults : [{}]) {
          const b = asRecord(block)
          const toolUseId = str(b.tool_use_id)
          const open = toolUseId ? this.pending.get(toolUseId) : undefined
          if (toolUseId) this.pending.delete(toolUseId)
          const tool = open?.tool
          const resultRecord = asRecord(raw.toolUseResult)
          const isAsyncAgent = str(resultRecord.status) === 'async_launched'
          const agentId = str(resultRecord.agentId)

          if (agentId && isAsyncAgent) {
            spawned.push({
              agentId,
              description: str(resultRecord.description),
              model: str(resultRecord.resolvedModel),
              toolUseId,
            })
          } else if (tool === 'Agent' && toolUseId) {
            finished.push(toolUseId)
          }

          const taskUpdate = updateFromToolResult(
            tool,
            open?.input,
            raw.toolUseResult,
            textOf(b.content),
            ts,
            toolUseId,
          )
          if (taskUpdate) {
            if (taskUpdate.action === 'start') this.taskKinds.set(taskUpdate.id, taskUpdate.kind)
            tasks.push(taskUpdate)
          }

          const { payload, truncated } = safePayload(raw.toolUseResult ?? b.content)
          const described = describeToolResult(tool, raw.toolUseResult ?? b.content)
          // El resultado de `TaskStop` no dice si lo parado era un shell o un monitor; si la
          // tarea se vio nacer, se sabe.
          if (described.stat?.kind === 'taskEnded') {
            const known = this.taskKinds.get(described.stat.id)
            if (known) described.stat = { ...described.stat, task: known }
          }
          events.push({
            ...base,
            uuid: toolResults.length > 1 && toolUseId ? `${uuid}:${toolUseId}` : uuid,
            kind: 'tool_result',
            tool,
            station: stationForTool(tool),
            summary: described.summary,
            stat: described.stat,
            payload,
            truncated,
            toolUseId,
            durationMs: open
              ? Math.max(0, Date.parse(ts) - Math.max(open.ts, this.lastAssistantTs))
              : undefined,
            isError: b.is_error === true,
          })
        }
        return { events, hints, spawned, finished, tasks }
      }

      // Prompt del usuario. Los inyectados por el sistema empiezan por '<' (recordatorios,
      // notificaciones de tarea) y no son cosas que el usuario haya escrito.
      const synthetic = text.trimStart().startsWith('<') || text.startsWith('Caveat:')
      if (!text || synthetic) return { events, hints, spawned, finished, tasks }
      const { payload, truncated } = safePayload(text)
      events.push({
        ...base,
        uuid,
        kind: 'prompt',
        station: 'desk',
        summary: clip(text),
        payload,
        truncated,
      })
      return { events, hints, spawned, finished, tasks }
    }

    if (type === 'assistant') {
      const model = str(message.model)
      if (model) hints.model = model
      const usage = usageOf(message)
      const messageId = str(message.id)
      const firstOfMessage = !messageId || messageId !== this.lastMessageId
      if (messageId) this.lastMessageId = messageId
      // El contexto en uso es un «último», no una suma: vale en cualquier línea.
      if (usage) hints.lastContextTokens = usage.input + usage.cacheRead + usage.cacheCreate
      // Los tokens de la respuesta viajan en la primera línea de cada mensaje y solo en ella.
      const tokens = firstOfMessage ? usage : undefined
      if (tokens) hints.tokens = tokens
      const at = Date.parse(ts)
      if (Number.isFinite(at)) this.lastAssistantTs = at
      const blocks = Array.isArray(message.content) ? message.content : []

      for (const [index, block] of blocks.entries()) {
        const b = asRecord(block)
        const blockType = str(b.type)
        const evUuid = blocks.length > 1 ? `${uuid}:${index}` : uuid
        let kind: EventKind | null = null
        let summary = ''
        let stat: Stat | undefined
        let tool: string | undefined
        let payloadSource: unknown = b

        if (blockType === 'thinking') {
          kind = 'thinking'
          const thought = str(b.thinking) ?? ''
          if (thought.trim()) {
            summary = clip(thought)
            payloadSource = thought
          } else {
            // Con algunos modelos Claude Code guarda solo la firma del razonamiento, no el texto.
            // El bloque sigue siendo tiempo pensando, y el mundo debe enseñarlo como tal.
            summary = 'razonamiento (no guardado en el transcript)'
            stat = { kind: 'hiddenThinking' }
            payloadSource = undefined
          }
        } else if (blockType === 'text') {
          kind = 'text'
          summary = clip(str(b.text) ?? '')
          payloadSource = str(b.text)
        } else if (blockType === 'tool_use') {
          tool = str(b.name) ?? '?'
          const toolUseId = str(b.id)
          if (toolUseId) this.pending.set(toolUseId, { ts: Date.parse(ts), tool, input: b.input })
          kind = tool === 'Skill' ? 'skill' : 'tool_call'
          const described = describeToolInput(tool, b.input, this.ctx.cwd ?? hints.cwd)
          summary = described.summary
          payloadSource = b.input
          const { payload, truncated } = safePayload(payloadSource)
          events.push({
            ...base,
            uuid: evUuid,
            kind,
            tool,
            station: stationForTool(tool),
            summary,
            stat: described.stat,
            payload,
            truncated,
            toolUseId,
            tokens,
            model,
          })
          continue
        }

        if (!kind || !summary) continue
        const { payload, truncated } = safePayload(payloadSource)
        events.push({
          ...base,
          uuid: evUuid,
          kind,
          station: 'desk',
          summary,
          stat,
          payload,
          truncated,
          tokens,
          model,
        })
      }
      return { events, hints, spawned, finished, tasks }
    }

    return { events, hints, spawned, finished, tasks }
  }
}
