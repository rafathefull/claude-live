/**
 * Pruebas del agregador de métricas contra los transcripts de esta máquina.
 *
 * Aquí lo que importa es que las cuentas cuadren: los días salen del timestamp de cada evento,
 * una sesión se cuenta una vez y en su primer día, y un subagente cuenta por su propio fichero
 * (en el transcript no hay evento de nacimiento: eso lo sintetiza el registro en vivo).
 *
 *   npm run test:metrics-server
 */
import { computeMetrics, dayOf } from '../src/metrics.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

console.log('\ndía de un timestamp')
check(dayOf('2026-07-27T23:59:59.999Z') === '2026-07-27', 'se recorta el ISO sin tocar la hora')
check(dayOf(undefined) === null && dayOf('') === null, 'sin timestamp, no hay día')
check(dayOf('no es una fecha') === null, 'y una cadena rara no se cuela como día')

console.log('\nagregado real')
const first = await computeMetrics({ force: true })
console.log(
  `  ${first.transcripts} transcripts · ${first.reread} releídos · ${first.computedInMs} ms`,
)
check(first.transcripts > 0, 'hay transcripts que medir')
check(first.reread === first.transcripts, 'con force se releen todos')

const days = Object.keys(first.byDay)
check(days.length > 0, `${days.length} días con actividad`)
check(
  days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
  'todas las claves de día tienen forma de fecha',
)

const totalEvents = Object.values(first.byDay).reduce((n, bucket) => n + bucket.events, 0)
const projectEvents = Object.values(first.byProject).reduce((n, bucket) => n + bucket.events, 0)
check(
  totalEvents === projectEvents,
  `los eventos cuadran por día y por proyecto (${totalEvents})`,
)

const perProjectDays = Object.values(first.projectDays).reduce(
  (n, byDay) => n + Object.values(byDay).reduce((m, bucket) => m + bucket.events, 0),
  0,
)
check(perProjectDays === totalEvents, 'y el desglose proyecto×día también')

const toolCalls = Object.values(first.byDay).reduce((n, bucket) => n + bucket.toolCalls, 0)
const toolCounts = Object.values(first.tools).reduce((n, count) => n + count, 0)
check(
  toolCalls === toolCounts,
  `cada llamada aparece una vez en el ranking de herramientas (${toolCalls})`,
)

const agents = Object.values(first.byDay).reduce((n, bucket) => n + bucket.agents, 0)
const agentTypes = Object.values(first.agentTypes).reduce((n, count) => n + count, 0)
check(agents === agentTypes, `los subagentes cuadran con sus tipos (${agents})`)
check(agents > 0, 'y se cuentan de verdad, que en el transcript no hay evento de nacimiento')

const sessions = Object.values(first.byDay).reduce((n, bucket) => n + bucket.sessions, 0)
check(sessions > 0 && sessions <= first.transcripts, `${sessions} sesiones, nunca más que ficheros`)

console.log('\nsegunda pasada (caché)')
const second = await computeMetrics()
// Los transcripts de las sesiones vivas crecen mientras esto corre —incluida la que está
// ejecutando la prueba—, así que releer unos pocos es lo correcto; lo que no puede es releerlos
// todos.
check(
  second.reread < Math.max(3, first.transcripts / 10),
  `casi nada se relee: ${second.reread} de ${first.transcripts}`,
)
check(
  second.computedInMs < first.computedInMs / 2,
  `y es mucho más rápida: ${second.computedInMs} ms vs ${first.computedInMs} ms`,
)
const eventsOf = (metrics: Awaited<ReturnType<typeof computeMetrics>>): number =>
  Object.values(metrics.byDay).reduce((n, bucket) => n + bucket.events, 0)
check(
  eventsOf(second) >= eventsOf(first),
  `y el recuento no se pierde por el camino (${eventsOf(first)} → ${eventsOf(second)})`,
)

// Lo que sí debe ser idéntico es el pasado: un día ya cerrado no cambia porque hoy se trabaje.
const closedDays = Object.keys(first.byDay).sort().slice(0, -1)
const sameHistory = closedDays.every(
  (day) => JSON.stringify(first.byDay[day]) === JSON.stringify(second.byDay[day]),
)
check(sameHistory, `los ${closedDays.length} días ya cerrados salen idénticos`)

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} comprobación(es) fallida(s)`)
process.exit(failures === 0 ? 0 : 1)
