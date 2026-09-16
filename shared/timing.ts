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
 * Vive en `shared/` porque la misma cuenta sirve al servidor (sobre el transcript completo, y
 * en el agregado de métricas por día), al front (sobre lo cargado, o lo reproducido hasta el
 * momento) y a la demostración sin servidor. El acumulador trabaja en streaming: recibe los
 * eventos uno a uno y avisa de cada hueco que atribuye, para que las métricas lo repartan por día.
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

export type TimingCategories = Record<TimingCategory, number>

export function emptyTimingCategories(): TimingCategories {
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

export function addTimingCategories(target: TimingCategories, source: Partial<TimingCategories>): void {
  for (const category of TIMING_CATEGORIES) target[category] += source[category] ?? 0
}

/** Suma de todas las categorías: el tiempo activo. */
export function activeMsOf(categories: Partial<TimingCategories> | undefined): number {
  if (!categories) return 0
  let total = 0
  for (const category of TIMING_CATEGORIES) total += categories[category] ?? 0
  return total
}

/** Suma de lo que es tiempo de Claude o de la máquina, y de lo que es tuyo. */
export function timingSidesOf(
  categories: Partial<TimingCategories> | undefined,
): { machine: number; you: number } {
  let machine = 0
  let you = 0
  for (const category of TIMING_CATEGORIES) {
    const value = categories?.[category] ?? 0
    if (TIMING_SIDE[category] === 'machine') machine += value
    else you += value
  }
  return { machine, you }
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
  categories: TimingCategories
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
  /**
   * Aviso por cada hueco atribuido, con la hora en que empezó: las métricas lo usan para repartir
   * el tiempo por día. Las pausas también se avisan, como `'pause'`, por si interesan.
   */
  onGap?: (category: TimingCategory | 'pause', ms: number, fromTs: string) => void
}

/**
 * Reparte el tiempo evento a evento. Los eventos de la sesión principal tienen que llegar en
 * orden de hora (así salen del transcript); los de subagentes se anotan aparte, en cualquier
 * orden, porque solo cuentan su primer y último instante.
 */
export class TimingAccumulator {
  private readonly pauseMs: number
  private readonly onGap?: TimingOptions['onGap']
  readonly categories = emptyTimingCategories()
  private pausedMs = 0
  private pauses = 0
  private turns = 0
  private calls = 0
  private events = 0
  private firstTs?: string
  private lastTs?: string
  private prev: TimelineEvent | null = null
  private prevT = 0
  private readonly pendingTools = new Map<string, string>()
  private readonly callByUse = new Map<string, TimelineEvent>()
  private readonly toolRows = new Map<string, ToolTiming>()
  private readonly durations: SlowCall[] = []
  private readonly agentsById = new Map<string, AgentTiming & { first: number; last: number }>()

  constructor(opts: TimingOptions = {}) {
    this.pauseMs = opts.pauseMs ?? DEFAULT_PAUSE_MS
    this.onGap = opts.onGap
  }

  push(e: TimelineEvent): void {
    this.events++
    const t = Date.parse(e.ts)
    if (!Number.isFinite(t)) return

    if (e.agentId) {
      this.noteAgent(e, t)
      return
    }
    if (NOT_A_TICK.has(e.kind)) return

    if (this.prev) {
      const gap = t - this.prevT
      if (gap > this.pauseMs) {
        this.pausedMs += gap
        this.pauses++
        this.onGap?.('pause', gap, this.prev.ts)
      } else if (gap > 0) {
        const category = categoryFor(e, this.prev, this.pendingTools)
        this.categories[category] += gap
        this.onGap?.(category, gap, this.prev.ts)
      }
    } else {
      this.firstTs = e.ts
    }
    this.lastTs = e.ts

    if ((e.kind === 'tool_call' || e.kind === 'skill') && e.toolUseId) {
      this.pendingTools.set(e.toolUseId, e.tool ?? '?')
      this.callByUse.set(e.toolUseId, e)
    } else if (e.kind === 'thinking' || e.kind === 'text' || e.kind === 'prompt') {
      // Claude no sigue hasta tener todos los resultados, y tú no escribes con una herramienta
      // en marcha salvo para interrumpirla: llegado aquí, nada sigue pendiente. Sin esto, una
      // llamada interrumpida quedaba «corriendo» para siempre y se llevaba las esperas.
      this.pendingTools.clear()
      if (e.kind === 'prompt') this.turns++
    } else if (e.kind === 'tool_result') {
      this.noteResult(e, t)
    }

    this.prev = e
    this.prevT = t
  }

  private noteResult(e: TimelineEvent, t: number): void {
    const call = e.toolUseId ? this.callByUse.get(e.toolUseId) : undefined
    if (e.toolUseId) {
      this.pendingTools.delete(e.toolUseId)
      this.callByUse.delete(e.toolUseId)
    }
    const tool = e.tool ?? call?.tool
    const ms = e.durationMs ?? (call ? Math.max(0, t - Date.parse(call.ts)) : undefined)
    if (!tool || ms === undefined) return

    // Una llamada que «duró» más que el umbral de pausa atravesó un cierre de sesión.
    const capped = Math.min(ms, this.pauseMs)
    const row = this.toolRows.get(tool) ?? { tool, calls: 0, totalMs: 0, maxMs: 0 }
    row.calls++
    row.totalMs += capped
    row.maxMs = Math.max(row.maxMs, capped)
    this.toolRows.set(tool, row)
    this.calls++
    if (ASKING_TOOLS.has(tool)) return

    // Solo se guardan las candidatas a «más largas»: con miles de llamadas, la lista entera sobra.
    this.durations.push({
      uuid: call?.uuid ?? e.uuid,
      tool,
      summary: descriptionOf(call) || call?.summary || e.summary,
      ts: call?.ts ?? e.ts,
      ms: capped,
    })
    if (this.durations.length > SLOWEST * 4) {
      this.durations.sort((a, b) => b.ms - a.ms).length = SLOWEST
    }
  }

  private noteAgent(e: TimelineEvent, t: number): void {
    const id = e.agentId as string
    const row = this.agentsById.get(id) ?? {
      id,
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
    this.agentsById.set(id, row)
  }

  report(partial = false): TimingReport {
    const spanMs =
      this.firstTs && this.lastTs
        ? Math.max(0, Date.parse(this.lastTs) - Date.parse(this.firstTs))
        : 0
    return {
      firstTs: this.firstTs,
      lastTs: this.lastTs,
      spanMs,
      activeMs: Math.max(0, spanMs - this.pausedMs),
      pausedMs: this.pausedMs,
      pauses: this.pauses,
      pauseThresholdMs: this.pauseMs,
      categories: { ...this.categories },
      tools: [...this.toolRows.values()].sort((a, b) => b.totalMs - a.totalMs),
      slowest: [...this.durations].sort((a, b) => b.ms - a.ms).slice(0, SLOWEST),
      agents: [...this.agentsById.values()]
        .map(({ first, last, ...rest }) => ({ ...rest, ms: Math.max(0, last - first) }))
        .sort((a, b) => b.ms - a.ms),
      turns: this.turns,
      calls: this.calls,
      events: this.events,
      partial,
    }
  }
}

/** El reparto de una lista de eventos, que se ordena por hora antes de recorrerla. */
export function computeTiming(
  events: readonly TimelineEvent[],
  opts: TimingOptions = {},
): TimingReport {
  const acc = new TimingAccumulator(opts)
  const ordered = events
    .map((e, index) => ({ e, index, t: Date.parse(e.ts) }))
    // Estable: a igual hora, el orden de llegada. Las horas ilegibles, al final (no cuentan).
    .sort((a, b) => (a.t || Infinity) - (b.t || Infinity) || a.index - b.index)
  for (const { e } of ordered) acc.push(e)
  return acc.report(opts.partial ?? false)
}

/** Suma de lo que es tiempo de Claude o de la máquina, y de lo que es tuyo. */
export function timingSides(report: TimingReport): { machine: number; you: number } {
  return timingSidesOf(report.categories)
}
