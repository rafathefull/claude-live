import { readFileSync, readdirSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskEnd, TaskInfo, TaskKind } from '../../shared/types.js'

/**
 * Shells y monitores en segundo plano: lo que Claude Code llama «tareas» de tipo `local_bash`.
 *
 * No hay hook ni fichero que los liste. El rastro está en tres sitios, y aquí se cruzan:
 *
 *   1. El transcript. El `tool_result` de un `Bash` con `run_in_background` trae
 *      `backgroundTaskId`; el de un `Monitor`, `taskId`. Cada evento del monitor y el fin de un
 *      shell llegan como `<task-notification>` (en una línea `queue-operation` y, si Claude
 *      estaba despierto, también en una línea `user`). `TaskStop` devuelve `task_type: local_bash`.
 *   2. La salida: `/tmp/claude-<uid>/<slug>/<sessionId>/tasks/<id>.output`, que se crea al
 *      primer byte (un monitor callado no tiene fichero) y acaba en `[killed]` o
 *      `[exited with code N]`.
 *   3. El proceso: un hijo del pid de la sesión, `bash -c "source <snapshot> && eval <command>"`,
 *      cuya hora de arranque en /proc da el tiempo que lleva corriendo. Como en `jobs.ts`, una
 *      tarea que se dice en marcha sin proceso detrás se marca como residuo: decir que corre
 *      sería mentir.
 */

/* ------------------------------------------------------------ actualizaciones */

/** Lo que el parser saca de una línea del transcript sobre una tarea. */
export type TaskUpdate =
  | {
      action: 'start'
      id: string
      kind: TaskKind
      ts: string
      command: string
      description?: string
      toolUseId?: string
      timeoutMs?: number
      outputPath?: string
    }
  | { action: 'event'; id: string; ts: string; text: string; description?: string }
  | {
      action: 'end'
      id: string
      ts: string
      status: TaskEnd
      exitCode?: number
      /** Solo cuando la tarea no se había visto nacer: para poder crearla con algo de contexto. */
      kind?: TaskKind
      command?: string
      description?: string
      outputPath?: string
    }

/**
 * Trozos que tiene una línea del transcript si habla de una tarea. Sirven para recorrer una
 * conversación entera sin parsear más que esas líneas: un shell lanzado hace tres horas queda
 * muy por detrás de la cola que se lee al adoptar una sesión.
 */
export const TASK_LINE_HINTS = [
  'backgroundTaskId',
  '"taskId"',
  '<task-notification>',
  '"task_type"',
  '"run_in_background":true',
  '"name":"Monitor"',
  '"name":"TaskStop"',
]

export function mentionsTask(line: string): boolean {
  return TASK_LINE_HINTS.some((hint) => line.includes(hint))
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * Resultado de una herramienta → nacimiento o parada de una tarea, si lo es.
 *
 * `input` es lo que se le pasó a la herramienta (el comando y la descripción viven ahí, no en
 * el resultado) y `content` el texto que vio el modelo, que en un shell en background incluye
 * la ruta del fichero de salida.
 */
export function updateFromToolResult(
  tool: string | undefined,
  input: unknown,
  result: unknown,
  content: string,
  ts: string,
  toolUseId?: string,
): TaskUpdate | null {
  const r = record(result)
  const i = record(input)

  const shellId = text(r.backgroundTaskId)
  if (shellId) {
    const path = /written to: (\S+?\.output)/.exec(content)?.[1]
    return {
      action: 'start',
      id: shellId,
      kind: 'shell',
      ts,
      command: text(i.command) ?? '',
      description: text(i.description),
      toolUseId,
      outputPath: path,
    }
  }

  // Un monitor devuelve `{ taskId, timeoutMs, persistent }`. El nombre de la herramienta puede
  // faltar (un resultado cuya llamada quedó fuera del tramo leído), así que se reconoce por la
  // forma: `timeoutMs` no lo trae nadie más.
  const monitorId = text(r.taskId)
  if (monitorId && (tool === 'Monitor' || typeof r.timeoutMs === 'number')) {
    const ws = record(i.ws)
    return {
      action: 'start',
      id: monitorId,
      kind: 'monitor',
      ts,
      command: text(i.command) ?? (text(ws.url) ? `ws ${String(ws.url)}` : ''),
      description: text(i.description),
      toolUseId,
      timeoutMs:
        typeof r.timeoutMs === 'number'
          ? r.timeoutMs
          : typeof i.timeout_ms === 'number'
            ? i.timeout_ms
            : undefined,
    }
  }

  const message = text(r.message) ?? ''
  const stoppedId = text(r.task_id) ?? /stopped task: (\S+)/.exec(message)?.[1]
  if (stoppedId && (text(r.task_type) === 'local_bash' || /Successfully stopped task/.test(message))) {
    return {
      action: 'end',
      id: stoppedId,
      ts,
      status: 'stopped',
      command: text(r.command),
    }
  }

  return null
}

/* -------------------------------------------------------------- notificaciones */

/** Una `<task-notification>` tal como la escribe Claude Code, ya desmontada. */
export interface TaskNotification {
  id: string
  status?: string
  summary?: string
  /** Solo monitores: la línea (o líneas) que emitió el script. */
  event?: string
  outputFile?: string
  toolUseId?: string
  /** El texto íntegro, para el payload del evento. */
  raw: string
}

function tag(block: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return match ? match[1].trim() : undefined
}

/** Todas las notificaciones de un texto (un mensaje puede traer varias). */
export function parseTaskNotifications(source: string): TaskNotification[] {
  const out: TaskNotification[] = []
  const re = /<task-notification>([\s\S]*?)<\/task-notification>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const block = match[1]
    const id = tag(block, 'task-id')
    if (!id) continue
    out.push({
      id,
      status: tag(block, 'status'),
      summary: tag(block, 'summary'),
      event: tag(block, 'event'),
      outputFile: tag(block, 'output-file'),
      toolUseId: tag(block, 'tool-use-id'),
      raw: match[0],
    })
  }
  return out
}

/** `Monitor event: "errores en deploy.log"` → `errores en deploy.log`. */
function quotedIn(summary: string | undefined): string | undefined {
  const match = summary ? /"([^"]+)"/.exec(summary) : null
  return match?.[1]
}

/**
 * Notificación → actualización, o null si no habla de un shell ni de un monitor (las de los
 * subagentes también viajan así, pero esas ya tienen su propio ciclo de vida en el mundo).
 */
export function updateFromNotification(n: TaskNotification, ts: string): TaskUpdate | null {
  const summary = n.summary ?? ''

  if (n.event !== undefined) {
    // La caducidad (y la parada por exceso de eventos) no llegan como estado sino como un
    // «evento» de control entre corchetes: `[Monitor expired after 30m with no events…]`.
    const control = /^\[Monitor\b([^\]]*)\]/i.exec(n.event.trim())
    if (control) {
      const body = control[1]
      const status: TaskEnd | null = /expir|timed? ?out|deadline/i.test(body)
        ? 'expired'
        : /stopp|kill|too many|ended|exit/i.test(body)
          ? 'stopped'
          : null
      if (status) {
        return {
          action: 'end',
          id: n.id,
          ts,
          status,
          kind: 'monitor',
          description: quotedIn(summary),
        }
      }
    }
    return { action: 'event', id: n.id, ts, text: n.event, description: quotedIn(summary) }
  }

  const isShell = /^Background command/i.test(summary)
  const isMonitor = /^Monitor\b/i.test(summary)
  if (!isShell && !isMonitor) return null

  const exit = /exit code (-?\d+)/i.exec(summary)
  const exitCode = exit ? Number(exit[1]) : undefined
  let status: TaskEnd
  if (/expir|timed? ?out|deadline/i.test(summary)) status = 'expired'
  else if (n.status === 'stopped' || /stopped|killed/i.test(summary)) status = 'stopped'
  else if (exitCode !== undefined && exitCode !== 0) status = 'failed'
  else if (n.status === 'completed' || /completed|finished|exited/i.test(summary)) status = 'completed'
  else return null

  return {
    action: 'end',
    id: n.id,
    ts,
    status,
    exitCode,
    kind: isShell ? 'shell' : 'monitor',
    description: quotedIn(summary),
    outputPath: n.outputFile,
  }
}

/* ------------------------------------------------------------- fichero de salida */

/**
 * Base de los ficheros de salida. Claude Code usa el directorio temporal del sistema y el uid;
 * se puede forzar con `CLAUDE_LIVE_TASKS_DIR` si algún día lo mueve.
 */
export const TASKS_BASE =
  process.env.CLAUDE_LIVE_TASKS_DIR ??
  join(tmpdir(), `claude-${typeof process.getuid === 'function' ? process.getuid() : 'unknown'}`)

export function outputPathFor(slug: string, sessionId: string, id: string): string {
  return join(TASKS_BASE, slug, sessionId, 'tasks', `${id}.output`)
}

/** `[exited with code 0]` / `[killed]` al final del fichero: cómo acabó. */
export function endMarkerOf(tail: string): { status: TaskEnd; exitCode?: number } | null {
  const trimmed = tail.trimEnd()
  if (/\[killed\]$/.test(trimmed)) return { status: 'stopped' }
  const exited = /\[exited with code (-?\d+)\]$/.exec(trimmed)
  if (exited) {
    const exitCode = Number(exited[1])
    return { status: exitCode === 0 ? 'completed' : 'failed', exitCode }
  }
  return null
}

export interface OutputTail {
  exists: boolean
  size: number
  /** La cola del fichero, en UTF-8, con el marcador final incluido si lo hay. */
  text: string
  /** true si el fichero era más largo que lo devuelto. */
  truncated: boolean
  end: ReturnType<typeof endMarkerOf>
}

/** Últimos `maxBytes` del fichero de salida, sin cargarlo entero (hay salidas de megas). */
export async function readOutputTail(path: string, maxBytes = 64 * 1024): Promise<OutputTail> {
  let handle
  try {
    handle = await open(path, 'r')
    const { size } = await handle.stat()
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const buffer = Buffer.allocUnsafe(length)
    if (length > 0) await handle.read(buffer, 0, length, start)
    let body = buffer.toString('utf8')
    // Si se recortó por el principio, la primera línea puede venir partida.
    if (start > 0) body = body.slice(body.indexOf('\n') + 1)
    return { exists: true, size, text: body, truncated: start > 0, end: endMarkerOf(body) }
  } catch {
    return { exists: false, size: 0, text: '', truncated: false, end: null }
  } finally {
    await handle?.close()
  }
}

/* ---------------------------------------------------------------- procesos */

export interface ProcInfo {
  pid: number
  cmdline: string
  /** Hora de arranque en reloj de pared, en ms. */
  startedAtMs: number
}

/** Ticks por segundo de /proc: 100 en todos los Linux que importan. */
const CLK_TCK = 100
let bootTimeMs: number | null | undefined

function bootTime(): number | null {
  if (bootTimeMs !== undefined) return bootTimeMs
  try {
    const match = /^btime (\d+)/m.exec(readFileSync('/proc/stat', 'utf8'))
    bootTimeMs = match ? Number(match[1]) * 1000 : null
  } catch {
    bootTimeMs = null
  }
  return bootTimeMs
}

function procOf(pid: number): ProcInfo | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    const fields = stat.slice(close + 2).trim().split(/\s+/)
    const startTicks = Number(fields[19])
    const boot = bootTime()
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
    return {
      pid,
      cmdline,
      startedAtMs: boot !== null && Number.isFinite(startTicks) ? boot + (startTicks * 1000) / CLK_TCK : 0,
    }
  } catch {
    return null
  }
}

/** ¿Hay /proc? Sin él (macOS) no se contrasta nada y se cree al transcript. */
export function canInspectProcesses(): boolean {
  return bootTime() !== null
}

/**
 * Hijos directos de un proceso. Primero por `/proc/<pid>/task/<pid>/children`, que es una
 * lectura; si el kernel no lo trae, recorriendo /proc y mirando el PPid de cada uno.
 */
export function listChildren(pid: number): ProcInfo[] {
  let pids: number[] = []
  try {
    pids = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
  } catch {
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue
        try {
          const status = readFileSync(`/proc/${entry}/status`, 'utf8')
          const ppid = /^PPid:\s*(\d+)/m.exec(status)?.[1]
          if (Number(ppid) === pid) pids.push(Number(entry))
        } catch {
          // desapareció entre el readdir y la lectura
        }
      }
    } catch {
      return []
    }
  }
  return pids.map(procOf).filter((p): p is ProcInfo => p !== null)
}

/** Trozo del comando con el que buscarlo en la línea de órdenes del proceso. */
function fingerprintOf(command: string): string {
  const first = command
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 12 && !/^(cd|export|LOGDIR=|[A-Z_]+=)\S*$/.test(line))
  return (first ?? command.trim()).replace(/['"\\]/g, '').slice(0, 60)
}

/** Tolerancia entre la marca del transcript y el arranque real del proceso. */
const START_SLACK_MS = 20_000

/**
 * El proceso que corresponde a una tarea. Claude Code envuelve el comando en
 * `bash -c "source … && eval <command> …"`, así que se busca el comando dentro de la línea de
 * órdenes; si no aparece (comillas reescritas por el shell), vale un proceso arrancado a la
 * vez que la tarea. `taken` evita dar el mismo proceso a dos tareas.
 */
export function matchProcess(
  task: Pick<TaskInfo, 'command' | 'startedAt' | 'pid'>,
  candidates: readonly ProcInfo[],
  taken: Set<number>,
): ProcInfo | null {
  const free = candidates.filter((p) => !taken.has(p.pid))
  if (free.length === 0) return null

  // Si ya lo teníamos, y sigue ahí, es él.
  if (task.pid) {
    const same = free.find((p) => p.pid === task.pid)
    if (same) return same
  }

  const needle = fingerprintOf(task.command)
  if (needle.length >= 12) {
    const byCommand = free.find((p) => p.cmdline.replace(/['"\\]/g, '').includes(needle))
    if (byCommand) return byCommand
  }

  const started = Date.parse(task.startedAt)
  if (!Number.isFinite(started)) return null
  const wrappers = free.filter((p) => / eval /.test(p.cmdline) && p.startedAtMs > 0)
  let best: ProcInfo | null = null
  for (const p of wrappers) {
    const gap = Math.abs(p.startedAtMs - started)
    if (gap > START_SLACK_MS) continue
    if (!best || gap < Math.abs(best.startedAtMs - started)) best = p
  }
  return best
}

/* ---------------------------------------------------------------- rastreador */

/** Fallos seguidos al buscar el proceso antes de dar la tarea por residuo. */
const MISSES_BEFORE_STALE = 2
const MAX_EVENT_CHARS = 240

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function isOpen(task: TaskInfo): boolean {
  return task.state === 'running' || task.state === 'stale'
}

/** Las tareas de una sesión: se alimenta del parser y se contrasta con /proc y con /tmp. */
export class TaskTracker {
  private tasks = new Map<string, TaskInfo>()
  private misses = new Map<string, number>()

  constructor(
    private readonly sessionId: string,
    private readonly slug: string,
  ) {}

  /** En marcha primero; después, las más recientes. */
  list(): TaskInfo[] {
    return [...this.tasks.values()].sort(
      (a, b) =>
        Number(isOpen(b)) - Number(isOpen(a)) || b.startedAt.localeCompare(a.startedAt),
    )
  }

  get(id: string): TaskInfo | undefined {
    return this.tasks.get(id)
  }

  hasOpen(): boolean {
    for (const task of this.tasks.values()) if (isOpen(task)) return true
    return false
  }

  private create(id: string, kind: TaskKind, ts: string, command = ''): TaskInfo {
    const task: TaskInfo = {
      id,
      sessionId: this.sessionId,
      kind,
      state: 'running',
      command,
      startedAt: ts,
      events: 0,
      outputPath: outputPathFor(this.slug, this.sessionId, id),
      alive: false,
    }
    this.tasks.set(id, task)
    return task
  }

  /** Aplica lo que dice el transcript. Devuelve si algo cambió. */
  apply(update: TaskUpdate): boolean {
    switch (update.action) {
      case 'start': {
        const existing = this.tasks.get(update.id)
        // Ya se conocía por una notificación anterior (la llamada quedó fuera del tramo leído):
        // ahora se completa con lo que solo trae la llamada.
        const task = existing ?? this.create(update.id, update.kind, update.ts, update.command)
        task.kind = update.kind
        if (update.command) task.command = update.command
        if (update.description) task.description = update.description
        if (update.toolUseId) task.toolUseId = update.toolUseId
        if (update.timeoutMs) task.timeoutMs = update.timeoutMs
        if (update.outputPath) task.outputPath = update.outputPath
        if (!existing || update.ts < task.startedAt) task.startedAt = update.ts
        return true
      }
      case 'event': {
        const task =
          this.tasks.get(update.id) ?? this.create(update.id, 'monitor', update.ts)
        if (update.description && !task.description) task.description = update.description
        task.events++
        task.lastEvent = clip(update.text, MAX_EVENT_CHARS)
        task.lastEventAt = update.ts
        return true
      }
      case 'end': {
        const task =
          this.tasks.get(update.id) ??
          this.create(update.id, update.kind ?? 'shell', update.ts, update.command ?? '')
        if (update.description && !task.description) task.description = update.description
        if (update.command && !task.command) task.command = update.command
        if (update.outputPath) task.outputPath = update.outputPath
        if (!isOpen(task)) return false
        task.state = update.status
        task.endedAt = update.ts
        if (update.exitCode !== undefined) task.exitCode = update.exitCode
        task.alive = false
        task.pid = undefined
        return true
      }
    }
  }

  /** La sesión se cerró: lo que corría, murió con ella. */
  sessionDied(ts = new Date().toISOString()): boolean {
    let changed = false
    for (const task of this.tasks.values()) {
      if (!isOpen(task)) continue
      task.state = 'stopped'
      task.endedAt = ts
      task.alive = false
      task.pid = undefined
      changed = true
    }
    return changed
  }

  /**
   * Contrasta las tareas abiertas con la realidad: el fichero de salida (tamaño y marcador de
   * fin) y los procesos hijos de la sesión. Devuelve si algo cambió.
   */
  async refresh(
    sessionPid?: number,
    opts: { now?: number; processStartedAt?: number } = {},
  ): Promise<boolean> {
    const now = opts.now ?? Date.now()
    const open = [...this.tasks.values()].filter(isOpen)
    if (open.length === 0) return false
    const before = this.fingerprint()

    // Una sesión reanudada con --resume arrastra en su transcript las tareas de los procesos
    // anteriores. Claude Code las mata al salir, así que una tarea anterior al arranque del
    // proceso actual acabó con el proceso que la lanzó: no es un residuo, es historia.
    if (opts.processStartedAt) {
      for (const task of open) {
        if (Date.parse(task.startedAt) < opts.processStartedAt - START_SLACK_MS) {
          task.state = 'stopped'
          task.endedAt = new Date(opts.processStartedAt).toISOString()
          task.alive = false
          task.pid = undefined
        }
      }
    }

    for (const task of open) {
      if (!isOpen(task)) continue
      if (!task.outputPath) continue
      try {
        const { size, mtimeMs } = await stat(task.outputPath)
        if (size !== task.outputBytes) {
          task.outputBytes = size
          const tail = await readOutputTail(task.outputPath, 512)
          // El marcador se escribió al morir el proceso: la fecha del fichero es la hora del fin,
          // no el momento en que el visor lo ha visto (que puede ser un arranque, horas después).
          if (tail.end) this.endFromMarker(task, tail.end, mtimeMs || now)
        }
      } catch {
        // todavía no ha escrito nada: el fichero se crea al primer byte
      }
    }

    if (sessionPid && canInspectProcesses()) {
      const children = listChildren(sessionPid)
      const taken = new Set<number>()
      for (const task of this.tasks.values()) {
        if (!isOpen(task)) continue
        const proc = matchProcess(task, children, taken)
        if (proc) {
          taken.add(proc.pid)
          task.alive = true
          task.pid = proc.pid
          task.state = 'running'
          this.misses.delete(task.id)
          // La hora del proceso es la de verdad; la del transcript va uno o dos segundos antes.
          if (proc.startedAtMs > 0) task.startedAt = new Date(proc.startedAtMs).toISOString()
          continue
        }
        const misses = (this.misses.get(task.id) ?? 0) + 1
        this.misses.set(task.id, misses)
        task.alive = false
        task.pid = undefined
        if (misses >= MISSES_BEFORE_STALE) task.state = 'stale'
      }
    }

    return this.fingerprint() !== before
  }

  private endFromMarker(
    task: TaskInfo,
    end: { status: TaskEnd; exitCode?: number },
    endedAtMs: number,
  ): void {
    let status = end.status
    // Un monitor que aparece «matado» justo al cumplir su plazo no lo paró nadie: caducó.
    if (
      task.kind === 'monitor' &&
      status === 'stopped' &&
      task.timeoutMs &&
      endedAtMs - Date.parse(task.startedAt) >= task.timeoutMs - 5000
    ) {
      status = 'expired'
    }
    task.state = status
    task.endedAt = new Date(endedAtMs).toISOString()
    if (end.exitCode !== undefined) task.exitCode = end.exitCode
    task.alive = false
    task.pid = undefined
  }

  private fingerprint(): string {
    return [...this.tasks.values()]
      .map(
        (t) =>
          `${t.id}:${t.state}:${t.alive ? t.pid : 0}:${t.startedAt}:${t.outputBytes ?? -1}:${t.events}`,
      )
      .join('|')
  }
}
