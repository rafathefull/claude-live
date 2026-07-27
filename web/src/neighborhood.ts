import type { ActorInfo, StationId, TimelineEvent } from '@shared/types'

/**
 * Resumen de una sesión para la vista de vecindario.
 *
 * Vive fuera del componente para poder probarlo en Node: lo que aquí se rompe en silencio es
 * el recuento —contar los resultados además de las llamadas duplicaría el uso de cada
 * estación— y qué se considera «lo último que está haciendo», que no es el último evento a
 * secas (un resultado o un cambio de modo no dicen dónde está el actor).
 */

/** Cuántos eventos del final se miran. Un buffer entero por sesión y por repintado es de más. */
export const WINDOW = 200

export interface StationUse {
  station: StationId
  uses: number
}

export interface SessionSummary {
  /** Veces que se ha usado cada estación, solo llamadas a herramienta. */
  uses: Record<string, number>
  /** Dónde está trabajando ahora, para destacar su celda. */
  lastStation: StationId | null
  /** Qué se está haciendo allí: herramienta y una línea de detalle. */
  lastTool?: string
  lastSummary?: string
  /** Si lo último salió mal, la tarjeta lo dice. */
  lastFailed: boolean
  /** Cuándo fue eso. */
  lastTs?: string
  /** Subagentes de la sesión, los activos primero. */
  agents: ActorInfo[]
  /** Eventos mirados, para que la tarjeta pueda decir «sin actividad todavía». */
  seen: number
}

/** Un evento cuenta como «estar trabajando en un sitio» solo si es una llamada o una skill. */
function isWork(event: TimelineEvent): boolean {
  return event.kind === 'tool_call' || event.kind === 'skill'
}

export function summarizeSession(
  events: readonly TimelineEvent[],
  agents: readonly ActorInfo[],
): SessionSummary {
  const window = events.length > WINDOW ? events.slice(events.length - WINDOW) : events
  const uses: Record<string, number> = {}
  let last: TimelineEvent | undefined

  for (const event of window) {
    // Solo las llamadas: sumar también sus resultados contaría cada visita dos veces.
    if (!isWork(event)) continue
    uses[event.station] = (uses[event.station] ?? 0) + 1
    last = event
  }

  // El error se busca en el resultado, que es quien lo trae; y solo si es el del último trabajo.
  const failed = last?.toolUseId
    ? window.some((event) => event.toolUseId === last?.toolUseId && event.isError === true)
    : false

  return {
    uses,
    lastStation: last?.station ?? null,
    lastTool: last?.tool,
    lastSummary: last?.summary,
    lastFailed: failed,
    lastTs: last?.ts ?? events[events.length - 1]?.ts,
    agents: [...agents].sort(
      (a, b) => Number(b.done !== true) - Number(a.done !== true) || (a.id < b.id ? -1 : 1),
    ),
    seen: window.length,
  }
}
