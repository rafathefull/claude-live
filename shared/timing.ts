import type { Text } from './i18n.js'
import type { TimelineEvent } from './types.js'

/**
 * En qué se va el tiempo de una sesión.
 *
 * Cada evento lleva la hora en que se escribió, y cada bloque de una respuesta de Claude
 * (pensamiento, texto, cada llamada) se escribe al terminar de generarse. Así que el hueco entre
 * dos eventos consecutivos de la sesión principal es tiempo de *lo que estaba pasando* hasta el
 * segundo: si lo que llega es un pensamiento, Claude pensaba; si es un resultado, corría esa
 * herramienta; si es tu mensaje, te estaba esperando. Repartido así, las categorías suman
 * exactamente el tiempo activo, sin solapes, aunque hubiera varias herramientas en paralelo.
 *
 * Los huecos largos (cerrar y reanudar con --resume, irse a comer) se apartan como pausas para
 * que no se atribuyan a nada: nadie esperó ocho horas a un `grep`.
 *
 * Vive en `shared/` porque la misma función sirve al servidor (sobre el transcript completo), al
 * front (sobre lo cargado, o lo reproducido hasta el momento) y a la demostración sin servidor.
 */

export type TimingCategory =
  | 'thinking' // Claude pensando (bloques de razonamiento)
  | 'writing' // Claude escribiendo texto o componiendo llamadas
  | 'tools' // una herramienta corriendo (Bash, Read, MCP…)
  | 'agents' // esperando a un subagente lanzado en modo síncrono
  | 'permission' // esperando tu permiso (solo se ve con el hook PermissionRequest)
  | 'asking' // esperándote: una pregunta o un plan por aprobar
  | 'waiting' // esperándote: tu siguiente mensaje

/** Orden de pintado: primero lo que hace Claude, después las herramientas, al final las esperas. */
export const TIMING_CATEGORIES: TimingCategory[] = [
  'thinking',
  'writing',
  'tools',
  'agents',
  'permission',
  'asking',
  'waiting',
]

export const TIMING_TEXT: Record<TimingCategory, Text> = {
  thinking: { es: 'Claude pensando', en: 'Claude thinking' },
  writing: { es: 'Claude escribiendo', en: 'Claude writing' },
  tools: { es: 'herramientas corriendo', en: 'tools running' },
  agents: { es: 'esperando a subagentes', en: 'waiting for subagents' },
  permission: { es: 'esperando tu permiso', en: 'waiting for your permission' },
  asking: { es: 'esperándote: preguntas y planes', en: 'waiting on you: questions and plans' },
  waiting: { es: 'esperándote: tu siguiente mensaje', en: 'waiting on you: your next message' },
}

/** Qué categorías son «tiempo de Claude o de la máquina» y cuáles «tiempo tuyo». */
export const TIMING_SIDE: Record<TimingCategory, 'machine' | 'you'> = {
  thinking: 'machine',
  writing: 'machine',
  tools: 'machine',
  agents: 'machine',
  permission: 'you',
  asking: 'you',
  waiting: 'you',
}

export interface ToolTiming {
  tool: string
  calls: number
  totalMs: number
  maxMs: number
}

export interface SlowCall {
  /** uuid del evento de la llamada, para poder seleccionarlo en la timeline. */
  uuid: string
  tool: string
  summary: string
  ts: string
  ms: number
}

export interface AgentTiming {
  id: string
  agentType?: string
  description?: string
  /** De su primer evento al último: su tiempo de trabajo, en paralelo con la sesión. */
  ms: number
  events: number
}

export interface TimingReport {
  firstTs?: string
  lastTs?: string
  /** Del primer evento al último, pausas incluidas. */
  spanMs: number
  /** Lo que queda quitando las pausas: es lo que se reparte entre categorías. */
  activeMs: number
  pausedMs: number
  pauses: number
  pauseThresholdMs: number
  categories: Record<TimingCategory, number>
  /** Por herramienta, sumando cada llamada (las paralelas se solapan, aquí no importa). */
  tools: ToolTiming[]
  slowest: SlowCall[]
  agents: AgentTiming[]
  /** Mensajes tuyos. */
  turns: number
  /** Llamadas a herramientas con resultado. */
  calls: number
  events: number
  /** true si los eventos son solo un tramo: el búfer en vivo, o una reproducción a medias. */
  partial: boolean
}

/** Un hueco mayor que esto no es espera: es que la sesión estaba cerrada o abandonada. */
export const DEFAULT_PAUSE_MS = 30 * 60_000

/** Cuántas llamadas lentas se devuelven. */
const SLOWEST = 6

/** Herramientas cuya «duración» es en realidad tiempo tuyo. */
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])

/**
 * Eventos que no marcan el paso del tiempo. Los de nacimiento y muerte de subagentes son
 * sintéticos (llevan la hora en que se dedujeron, no la de la conversación) y los de sesión y
 * `meta` no son actividad de nadie.
 */
const NOT_A_TICK = new Set<TimelineEvent['kind']>([
  'agent_spawn',
  'agent_done',
  'meta',
  'session_start',
  'session_end',
])

function emptyCategories(): Record<TimingCategory, number> {
  return {
    thinking: 0,
    writing: 0,
    tools: 0,
    agents: 0,
    permission: 0,
    asking: 0,
    waiting: 0,
  }
}

/**
 * A qué se atribuye el hueco que termina en `event`. Se decide por lo que llega, porque es lo
 * que estaba en curso: un resultado dice qué herramienta corría, un pensamiento que Claude
 * pensaba, tu mensaje que te esperaba.
 */
function categoryFor(
  event: TimelineEvent,
  prev: TimelineEvent,
  pendingTools: ReadonlyMap<string, string>,
): TimingCategory {
  // Tras pedir permiso, todo lo que tarde en llegar lo siguiente es tuyo.
  if (prev.kind === 'permission') return 'permission'

  switch (event.kind) {
    case 'thinking':
      return 'thinking'
    case 'text':
    case 'tool_call':
    case 'skill':
      return 'writing'
    case 'prompt':
      return 'waiting'
    case 'tool_result': {
      const tool = event.tool ?? (event.toolUseId ? pendingTools.get(event.toolUseId) : undefined)
      if (tool && ASKING_TOOLS.has(tool)) return 'asking'
      if (tool === 'Agent') return 'agents'
      return 'tools'
    }
    case 'permission':
      // El aviso llega justo tras decidir la llamada: ese hueco es de componerla.
      return 'writing'
    default:
      // Un aviso de un monitor, o cualquier otra cosa, no dice nada por sí mismo: se atribuye a
      // lo que había en curso, herramientas si quedaba alguna sin resultado y espera si no.
      return pendingTools.size > 0 ? 'tools' : 'waiting'
  }
}

/**
 * La descripción con la que Claude lanzó la llamada («Compilar y pasar las suites»), que dice
 * más que el comando. Viaja en el payload de la llamada cuando la herramienta la admite.
 */
function descriptionOf(call: TimelineEvent | undefined): string | undefined {
  const payload = call?.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const description = (payload as { description?: unknown }).description
  return typeof description === 'string' && description.trim() ? description.trim() : undefined
}

export interface TimingOptions {
  pauseMs?: number
  /** Marca el informe como parcial (búfer en vivo, replay a medias). */
  partial?: boolean
}

export function computeTiming(
  events: readonly TimelineEvent[],
  opts: TimingOptions = {},
): TimingReport {
  const pauseMs = opts.pauseMs ?? DEFAULT_PAUSE_MS
  const categories = emptyCategories()

  const main = events
    .filter((e) => e.agentId === null && !NOT_A_TICK.has(e.kind) && Number.isFinite(Date.parse(e.ts)))
    .map((e, index) => ({ e, index, t: Date.parse(e.ts) }))
    // Estable: a igual hora, el orden de llegada.
    .sort((a, b) => a.t - b.t || a.index - b.index)

  let pausedMs = 0
  let pauses = 0
  let turns = 0
  const pendingTools = new Map<string, string>()
  const callByUse = new Map<string, TimelineEvent>()
  const toolRows = new Map<string, ToolTiming>()
  const durations: SlowCall[] = []
  let calls = 0
  let prev: TimelineEvent | null = null
  let prevT = 0

  for (const { e, t } of main) {
    if (prev) {
      const gap = t - prevT
      if (gap > pauseMs) {
        pausedMs += gap
        pauses++
      } else if (gap > 0) {
        categories[categoryFor(e, prev, pendingTools)] += gap
      }
    }

    if ((e.kind === 'tool_call' || e.kind === 'skill') && e.toolUseId) {
      pendingTools.set(e.toolUseId, e.tool ?? '?')
      callByUse.set(e.toolUseId, e)
    } else if (e.kind === 'thinking' || e.kind === 'text' || e.kind === 'prompt') {
      // Claude no sigue hasta tener todos los resultados, y tú no escribes con una herramienta
      // en marcha salvo para interrumpirla: llegado aquí, nada sigue pendiente. Sin esto, una
      // llamada interrumpida quedaba «corriendo» para siempre y se llevaba las esperas.
      pendingTools.clear()
      if (e.kind === 'prompt') turns++
    } else if (e.kind === 'tool_result') {
      const call = e.toolUseId ? callByUse.get(e.toolUseId) : undefined
      if (e.toolUseId) pendingTools.delete(e.toolUseId)
      const tool = e.tool ?? call?.tool
      const ms = e.durationMs ?? (call ? Math.max(0, t - Date.parse(call.ts)) : undefined)
      if (tool && ms !== undefined) {
        // Una llamada que «duró» más que el umbral de pausa atravesó un cierre de sesión.
        const capped = Math.min(ms, pauseMs)
        const row = toolRows.get(tool) ?? { tool, calls: 0, totalMs: 0, maxMs: 0 }
        row.calls++
        row.totalMs += capped
        row.maxMs = Math.max(row.maxMs, capped)
        toolRows.set(tool, row)
        calls++
        if (!ASKING_TOOLS.has(tool)) {
          durations.push({
            uuid: call?.uuid ?? e.uuid,
            tool,
            summary: descriptionOf(call) || call?.summary || e.summary,
            ts: call?.ts ?? e.ts,
            ms: capped,
          })
        }
      }
    }

    prev = e
    prevT = t
  }

  // Subagentes: de su primer evento al último. Trabajan en paralelo, así que se informan aparte
  // y no entran en el reparto.
  const agentsById = new Map<string, AgentTiming & { first: number; last: number }>()
  for (const e of events) {
    if (!e.agentId) continue
    const t = Date.parse(e.ts)
    if (!Number.isFinite(t)) continue
    const row = agentsById.get(e.agentId) ?? {
      id: e.agentId,
      agentType: e.actor?.agentType,
      description: e.actor?.description,
      ms: 0,
      events: 0,
      first: t,
      last: t,
    }
    row.agentType ??= e.actor?.agentType
    row.description ??= e.actor?.description
    row.first = Math.min(row.first, t)
    row.last = Math.max(row.last, t)
    row.events++
    agentsById.set(e.agentId, row)
  }
  const agents = [...agentsById.values()]
    .map(({ first, last, ...rest }) => ({ ...rest, ms: Math.max(0, last - first) }))
    .sort((a, b) => b.ms - a.ms)

  const first = main[0]
  const last = main[main.length - 1]
  const spanMs = first && last ? Math.max(0, last.t - first.t) : 0

  return {
    firstTs: first?.e.ts,
    lastTs: last?.e.ts,
    spanMs,
    activeMs: Math.max(0, spanMs - pausedMs),
    pausedMs,
    pauses,
    pauseThresholdMs: pauseMs,
    categories,
    tools: [...toolRows.values()].sort((a, b) => b.totalMs - a.totalMs),
    slowest: durations.sort((a, b) => b.ms - a.ms).slice(0, SLOWEST),
    agents,
    turns,
    calls,
    events: events.length,
    partial: opts.partial ?? false,
  }
}

/** Suma de lo que es tiempo de Claude o de la máquina, y de lo que es tuyo. */
export function timingSides(report: TimingReport): { machine: number; you: number } {
  let machine = 0
  let you = 0
  for (const category of TIMING_CATEGORIES) {
    if (TIMING_SIDE[category] === 'machine') machine += report.categories[category]
    else you += report.categories[category]
  }
  return { machine, you }
}
