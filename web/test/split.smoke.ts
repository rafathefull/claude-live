/**
 * Pruebas del acotado del divisor de la timeline. Sin navegador: es aritmética pura.
 *
 * Los dos errores que hay que evitar son simétricos: que el panel se coma el escenario, y
 * que un tope demasiado bajo impida ampliarlo de verdad en una pantalla ancha.
 *
 *   npm run test:split
 */
import { clampTimelineWidth, STAGE_MIN, TIMELINE_MIN } from '../src/split.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

console.log('\nacotado del ancho de la timeline')

const WIDE = 1920
const SPLIT = 7
check(clampTimelineWidth(900, WIDE, SPLIT) === 900, 'un ancho holgado se respeta tal cual')
check(
  clampTimelineWidth(1800, WIDE, SPLIT) === WIDE - SPLIT - STAGE_MIN,
  `arrastrar hasta el borde deja ${STAGE_MIN} px de mundo, contando el divisor ` +
    `(${clampTimelineWidth(1800, WIDE, SPLIT)} px de panel)`,
)
check(
  clampTimelineWidth(1800, WIDE) > 1500,
  'en pantalla ancha la timeline puede ocupar más de 1500 px: se puede ampliar de verdad',
)
check(clampTimelineWidth(10, WIDE) === TIMELINE_MIN, 'por debajo del mínimo se queda en el mínimo')
check(clampTimelineWidth(420.6, WIDE) === 421, 'el resultado es entero, sin píxeles fraccionarios')

// Ventana estrecha: el mínimo de la timeline gana al mínimo del escenario, porque si no
// el clamp devolvería un ancho negativo y el panel desaparecería.
const NARROW = TIMELINE_MIN + STAGE_MIN - 100
check(
  clampTimelineWidth(500, NARROW) === TIMELINE_MIN,
  'en una ventana muy estrecha no baja del mínimo legible',
)

// Reajuste al estrechar la ventana: aplicar el clamp dos veces no debe seguir moviéndolo.
const once = clampTimelineWidth(1500, 1280)
check(clampTimelineWidth(once, 1280) === once, 'el reajuste es estable (idempotente)')

console.log(failures === 0 ? '\ntodo en orden\n' : `\n${failures} fallo(s)\n`)
process.exit(failures === 0 ? 0 : 1)
