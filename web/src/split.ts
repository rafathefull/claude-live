/**
 * Ancho del panel de timeline, ajustable con el ratón.
 *
 * La lógica de acotado vive aquí y no en el componente para poder probarla en Node: el
 * error fácil de este divisor es dejar que el panel se coma el escenario (o al revés,
 * que no se pueda ampliar de verdad, que era la queja).
 */

/** Por debajo de esto la timeline deja de ser legible: dos columnas y texto partido. */
export const TIMELINE_MIN = 300

/** Lo que el mundo necesita para seguir siendo un mundo y no una rendija. */
export const STAGE_MIN = 320

const STORAGE_KEY = 'claude-live:timeline-width'

/**
 * Acota el ancho pedido al espacio realmente disponible. El máximo se calcula a partir del
 * ancho del cuerpo, así que en una pantalla ancha la timeline puede ocupar casi todo.
 *
 * `splitterWidth` es la columna que ocupa el propio divisor: sin descontarla el escenario
 * se quedaba unos píxeles por debajo de su mínimo al llegar al tope.
 */
export function clampTimelineWidth(
  width: number,
  bodyWidth: number,
  splitterWidth = 0,
): number {
  const max = Math.max(TIMELINE_MIN, bodyWidth - splitterWidth - STAGE_MIN)
  return Math.round(Math.min(max, Math.max(TIMELINE_MIN, width)))
}

/** Lee la preferencia guardada. `null` = nunca se ha tocado, manda el CSS por breakpoint. */
export function loadTimelineWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export function saveTimelineWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // Modo privado o almacenamiento lleno: el ajuste vale para esta sesión y punto.
  }
}
