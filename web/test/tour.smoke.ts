/**
 * Pruebas del recorrido guiado. Sin navegador: lo que se comprueba es que los pasos estén bien
 * declarados —los dos idiomas, sin anclas inventadas, sin saltos de pestaña absurdos— porque un
 * paso que apunta a un selector que no existe se queda sin resaltar y nadie se entera.
 *
 *   npm run test:tour
 */
import { TOUR, stepAt } from '../src/tour.js'

let failures = 0
function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

console.log('\npasos del recorrido')
check(TOUR.length >= 8, `${TOUR.length} paradas`)
check(new Set(TOUR.map((s) => s.id)).size === TOUR.length, 'los identificadores no se repiten')
check(
  TOUR.every((s) => s.title.es && s.title.en && s.body.es && s.body.en),
  'todos tienen título y texto en los dos idiomas',
)
check(
  TOUR.every((s) => s.body.es.length > 80 && s.body.en.length > 80),
  'y todos explican algo, no son una línea suelta',
)
check(TOUR[0]!.anchor.kind === 'center', 'la bienvenida va centrada')
check(TOUR[TOUR.length - 1]!.anchor.kind === 'center', 'y la despedida también')

console.log('\nanclas')
const canvasSteps = TOUR.filter((s) => s.anchor.kind === 'canvas')
check(canvasSteps.length >= 4, `${canvasSteps.length} paradas señalan un sitio del escenario`)
check(
  canvasSteps.every((s) => s.view === 'live'),
  'y todas ocurren en la pestaña del mundo, que es donde hay escenario',
)
check(
  canvasSteps.every(
    (s) =>
      s.anchor.kind === 'canvas' &&
      s.anchor.x > 0 &&
      s.anchor.x < 1 &&
      s.anchor.y > 0 &&
      s.anchor.y < 1,
  ),
  'sus fracciones caen dentro del lienzo',
)

// Los selectores tienen que existir en el código: si se renombra una clase, esto lo caza.
const { readFileSync, readdirSync } = await import('node:fs')
const sources = readdirSync('web/src/components')
  .filter((f) => f.endsWith('.vue'))
  .map((f) => readFileSync(`web/src/components/${f}`, 'utf8'))
  .join('\n')
const cssSteps = TOUR.filter((s) => s.anchor.kind === 'css')
for (const step of cssSteps) {
  if (step.anchor.kind !== 'css') continue
  const klass = step.anchor.selector.replace(/^\./, '')
  check(sources.includes(klass), `«${step.anchor.selector}» existe en la interfaz (paso ${step.id})`)
}

console.log('\nnavegación')
check(stepAt(-5) === 0, 'no se puede ir antes del primero')
check(stepAt(999) === TOUR.length - 1, 'ni después del último')
check(stepAt(3) === 3, 'y en medio, donde le digas')

console.log(failures === 0 ? '\ntodo en orden\n' : `\n${failures} fallo(s)\n`)
process.exit(failures === 0 ? 0 : 1)
