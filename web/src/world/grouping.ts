import type { EventKind, StationId } from '@shared/types'

/**
 * Regla de agrupación de acciones del mundo, aislada de Pixi para poder probarla con
 * transcripts reales (ver server/test/grouping.smoke.ts).
 */

export interface Groupable {
  kind: EventKind
  station?: StationId
  tool?: string
}

/** Acciones pendientes a partir de las cuales se empieza a agrupar. */
export const MERGE_BACKLOG = 3

/**
 * Solo se agrupa cuando hay atasco real: con la cola corta se representa cada paso, que es
 * lo que se quiere tanto en directo como en un replay.
 *
 * Nunca se agrupa un `tool_result` con su `tool_call`: comparten estación y herramienta, y
 * fusionarlos convertía la ida y la vuelta en un único movimiento — por eso una sesión de
 * 940 eventos se veía en cuatro pasos.
 */
export function shouldMerge(
  last: Groupable | undefined,
  next: Groupable,
  pending: number,
): boolean {
  if (!last || !next.station) return false
  if (pending < MERGE_BACKLOG) return false
  if (next.kind !== 'tool_call' && next.kind !== 'skill') return false
  return last.kind === next.kind && last.station === next.station && last.tool === next.tool
}
