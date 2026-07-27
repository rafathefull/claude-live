/**
 * Pruebas del filtrado de métricas de la vista.
 *
 * Lo que se rompe en silencio aquí: saltarse los días sin actividad —una semana de vacaciones
 * se dibujaría como trabajo seguido— y contar el rango desde hoy en vez de desde el último día
 * con datos, que con el histórico ya recortado por Claude Code deja la gráfica vacía.
 *
 *   npm run test:metrics
 */
import { ALL_PROJECTS, emptyBucket, nextDay, series, top, totals, valueOf } from '../src/metrics.js'
import type { Metrics, MetricsBucket } from '../../shared/types.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

function bucket(partial: Partial<MetricsBucket>): MetricsBucket {
  return { ...emptyBucket(), ...partial }
}

const metrics: Metrics = {
  byDay: {
    '2026-07-01': bucket({ events: 10, toolCalls: 4, sessions: 1, tokensIn: 100, tokensOut: 20 }),
    '2026-07-03': bucket({ events: 30, toolCalls: 12, sessions: 2, errors: 1 }),
    '2026-07-04': bucket({ events: 5, toolCalls: 1 }),
  },
  byProject: {
    backend: bucket({ events: 40, toolCalls: 16, sessions: 3 }),
    api: bucket({ events: 5, toolCalls: 1 }),
  },
  projectDays: {
    backend: {
      '2026-07-01': bucket({ events: 10, toolCalls: 4, sessions: 1 }),
      '2026-07-03': bucket({ events: 30, toolCalls: 12, sessions: 2, errors: 1 }),
    },
    api: { '2026-07-04': bucket({ events: 5, toolCalls: 1 }) },
  },
  tools: { Bash: 12, Edit: 30, Read: 30 },
  models: { 'claude-opus-5': 5 },
  agentTypes: { Explore: 2 },
  transcripts: 3,
  reread: 0,
  computedInMs: 4,
}

console.log('\nserie de días')
const all = series(metrics, ALL_PROJECTS, 0)
check(all.length === 4, `del 1 al 4 de julio son 4 puntos, no 3 (${all.length})`)
check(all[1]?.day === '2026-07-02' && all[1]?.bucket.events === 0, 'el día 2 sale a cero, no se salta')
check(all.map((point) => point.day).join(',') === '2026-07-01,2026-07-02,2026-07-03,2026-07-04', 'y en orden')

const win = series(metrics, ALL_PROJECTS, 2)
check(
  win.length === 2 && win[0]?.day === '2026-07-03',
  'el rango se cuenta desde el último día con datos, no desde hoy',
)

const byProject = series(metrics, 'api', 0)
check(byProject.length === 1 && byProject[0]?.bucket.events === 5, 'filtrar por proyecto usa sus días')
check(series(metrics, 'no-existe', 0).length === 0, 'un proyecto desconocido no inventa serie')

console.log('\ntotales y medidas')
const sum = totals(all)
check(sum.events === 45 && sum.toolCalls === 17, 'el total suma la serie completa')
check(totals(win).events === 35, 'y el del rango solo su ventana')
check(valueOf(sum, 'tokens') === 120, 'la medida «tokens» suma entrada y salida')
check(valueOf(sum, 'errors') === 1, 'y los errores son los errores')

console.log('\nrankings')
const tools = top(metrics.tools, 2)
check(tools.length === 2 && tools[0]!.n === 30, 'el ranking corta por arriba')
check(
  tools[0]!.key === 'Edit' && tools[1]!.key === 'Read',
  'y con empate ordena por nombre, para que no baile entre repintados',
)

console.log('\nfechas')
check(nextDay('2026-07-31') === '2026-08-01', 'el día siguiente cruza el mes')
check(nextDay('2026-12-31') === '2027-01-01', 'y el año')
check(nextDay('2028-02-28') === '2028-02-29', 'y sabe de años bisiestos')

console.log(failures === 0 ? '\ntodo en orden\n' : `\n${failures} fallo(s)\n`)
process.exit(failures === 0 ? 0 : 1)
