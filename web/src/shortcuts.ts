/**
 * Atajos de teclado del reproductor.
 *
 * El mapeo es una función pura para poder probarlo sin navegador: lo que se rompe en silencio
 * aquí no es la tecla, es el contexto —robarle el espacio al buscador del historial, o seguir
 * saltando eventos mientras escribes— así que eso también se decide aquí.
 */

export type ShortcutAction =
  | { kind: 'toggle' }
  | { kind: 'step'; delta: number }
  | { kind: 'seekStart' }
  | { kind: 'seekEnd' }
  | { kind: 'speed'; direction: 1 | -1 }

/** Salto grande, el mismo que hacen los botones ⏪ / ⏩. */
export const JUMP = 10

export interface KeyLike {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/**
 * Tecla → acción, o `null` si no es de las nuestras. Con Ctrl, Alt o Meta nunca se hace nada:
 * son atajos del navegador o del sistema y pisarlos siempre acaba mal.
 */
export function actionForKey(event: KeyLike): ShortcutAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  const big = event.shiftKey === true

  switch (event.key) {
    case ' ':
    case 'Spacebar': // navegadores viejos
    case 'k': // como en los reproductores de vídeo
      return { kind: 'toggle' }
    case 'ArrowLeft':
      return { kind: 'step', delta: big ? -JUMP : -1 }
    case 'ArrowRight':
      return { kind: 'step', delta: big ? JUMP : 1 }
    case 'Home':
      return { kind: 'seekStart' }
    case 'End':
      return { kind: 'seekEnd' }
    case 'ArrowUp':
    case '+':
      return { kind: 'speed', direction: 1 }
    case 'ArrowDown':
    case '-':
      return { kind: 'speed', direction: -1 }
    default:
      return null
  }
}

/**
 * Si el foco está en algo donde se escribe, el teclado es suyo: el buscador del histórico usa
 * espacios y flechas, y un atajo global se los comería.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || !element.tagName) return false
  if (element.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

/** Velocidad siguiente o anterior de la lista, sin salirse por los extremos. */
export function nextSpeed(current: number, direction: 1 | -1, speeds: readonly number[]): number {
  const index = speeds.indexOf(current)
  // Una velocidad que no esté en la lista (por un estado antiguo) se resuelve a la más cercana.
  const from =
    index !== -1
      ? index
      : speeds.reduce(
          (best, speed, i) =>
            Math.abs(speed - current) < Math.abs((speeds[best] ?? 0) - current) ? i : best,
          0,
        )
  const next = Math.max(0, Math.min(speeds.length - 1, from + direction))
  return speeds[next] ?? current
}
