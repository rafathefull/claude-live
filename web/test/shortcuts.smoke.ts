/**
 * Pruebas de los atajos del reproductor, sin navegador.
 *
 * Lo que aquí se rompe en silencio no es la tecla, es el contexto: robarle el espacio al
 * buscador del histórico, o pisar un atajo del navegador con Ctrl.
 *
 *   npm run test:shortcuts
 */
import { JUMP, actionForKey, isTypingTarget, nextSpeed } from '../src/shortcuts.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

const SPEEDS = [0.5, 1, 2, 4, 8, 16] as const

console.log('\nteclas → acciones')
check(actionForKey({ key: ' ' })?.kind === 'toggle', 'espacio reproduce y pausa')
check(actionForKey({ key: 'k' })?.kind === 'toggle', 'K también, como en los reproductores')
const left = actionForKey({ key: 'ArrowLeft' })
const right = actionForKey({ key: 'ArrowRight' })
check(left?.kind === 'step' && left.delta === -1, '← retrocede un evento')
check(right?.kind === 'step' && right.delta === 1, '→ avanza un evento')
const bigLeft = actionForKey({ key: 'ArrowLeft', shiftKey: true })
const bigRight = actionForKey({ key: 'ArrowRight', shiftKey: true })
check(
  bigLeft?.kind === 'step' && bigLeft.delta === -JUMP && bigRight?.kind === 'step' && bigRight.delta === JUMP,
  `con ⇧ el salto es de ${JUMP}, el mismo que los botones ⏪ ⏩`,
)
check(actionForKey({ key: 'Home' })?.kind === 'seekStart', 'Inicio va al principio')
check(actionForKey({ key: 'End' })?.kind === 'seekEnd', 'Fin va al final')
const up = actionForKey({ key: 'ArrowUp' })
const down = actionForKey({ key: 'ArrowDown' })
check(up?.kind === 'speed' && up.direction === 1, '↑ sube la velocidad')
check(down?.kind === 'speed' && down.direction === -1, '↓ la baja')
check(actionForKey({ key: 'a' }) === null, 'una tecla cualquiera no hace nada')

console.log('\nlo que no se debe pisar')
check(actionForKey({ key: ' ', ctrlKey: true }) === null, 'Ctrl+espacio se deja pasar')
check(actionForKey({ key: 'ArrowRight', metaKey: true }) === null, 'Meta+→ se deja pasar')
check(actionForKey({ key: 'ArrowLeft', altKey: true }) === null, 'Alt+← (atrás del navegador) se respeta')
check(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget), 'escribiendo en un input, no')
check(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget), 'ni en un textarea')
check(
  isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
  'ni en algo editable',
)
check(!isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget), 'sobre el mundo, sí')
check(!isTypingTarget(null), 'sin destino, sí')

console.log('\nvelocidades')
check(nextSpeed(1, 1, SPEEDS) === 2, 'de 1× se sube a 2×')
check(nextSpeed(1, -1, SPEEDS) === 0.5, 'y se baja a 0,5×')
check(nextSpeed(16, 1, SPEEDS) === 16, 'en el tope se queda en 16×')
check(nextSpeed(0.5, -1, SPEEDS) === 0.5, 'y en el suelo en 0,5×')
check(nextSpeed(3, 1, SPEEDS) === 4, 'una velocidad fuera de la lista se resuelve a la más cercana')

console.log(failures === 0 ? '\ntodo en orden\n' : `\n${failures} fallo(s)\n`)
process.exit(failures === 0 ? 0 : 1)
