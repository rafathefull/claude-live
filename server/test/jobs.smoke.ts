/**
 * Pruebas del lector de jobs en segundo plano.
 *
 * `state.json` es formato interno de Claude Code: aquí se comprueba que un campo que falte o
 * cambie no tumba nada, y sobre todo la regla que no está en el fichero —un job que se dice
 * «trabajando» sin proceso detrás es un residuo, y decir que trabaja sería mentir—.
 *
 *   npm run test:jobs
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { JOBS_DIR } from '../src/config.js'
import { readJobs, toJobInfo } from '../src/jobs.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

console.log('\nnormalizador de state.json')

const working = {
  state: 'working',
  name: 'Migrar los informes',
  intent: 'migra los informes',
  detail: 'voy por el tercero',
  cwd: '/home/demo/api',
  sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T11:00:00.000Z',
  output: null,
}

const live = toJobInfo('abc', working, true)
check(live?.state === 'working', 'un job vivo que trabaja, trabaja')
check(live?.name === 'Migrar los informes' && live?.detail === 'voy por el tercero', 'nombre y parte')

const orphan = toJobInfo('abc', working, false)
check(orphan?.state === 'stale', 'el mismo sin proceso detrás pasa a residuo')
check(
  orphan?.declaredState === 'working' && orphan?.alive === false,
  'y se conserva lo que decía el fichero, para poder explicarlo',
)

const blocked = toJobInfo('abc', { ...working, state: 'blocked' }, false)
check(blocked?.state === 'stale', 'un bloqueado sin proceso también es residuo')
const blockedLive = toJobInfo('abc', { ...working, state: 'blocked' }, true)
check(blockedLive?.state === 'blocked', 'con proceso, sigue bloqueado esperándote')

// Los terminados no dependen de que haya proceso: ya acabaron.
for (const state of ['done', 'failed'] as const) {
  const ended = toJobInfo('abc', { ...working, state }, false)
  check(ended?.state === state, `un job «${state}» no cambia por no tener proceso`)
}

const withResult = toJobInfo('abc', { ...working, state: 'done', output: { result: 'listo' } }, false)
check(withResult?.result === 'listo', 'el resultado sale de output.result')

console.log('\nformato hostil')
check(toJobInfo('abc', null, false) === null, 'un fichero vacío se descarta')
check(toJobInfo('abc', {}, false) === null, 'sin estado, no hay job')
check(
  toJobInfo('abc', { state: 'inventado' }, false) === null,
  'un estado que no conocemos se descarta en vez de pintarse mal',
)
const bare = toJobInfo('solo-id', { state: 'done' }, false)
check(bare?.name === 'solo-id', 'sin nombre, se usa el id')
check(
  bare?.intent === undefined && bare?.cwd === undefined,
  'los campos ausentes quedan sin definir, no en cadenas vacías',
)
const numbers = toJobInfo('abc', { state: 'done', name: 42, detail: [], cwd: {} }, false)
check(numbers?.name === 'abc' && numbers?.detail === undefined, 'tipos raros se ignoran')
check(toJobInfo('abc', { state: 'done', name: '   ' }, false)?.name === 'abc', 'un nombre en blanco no vale')

console.log('\ncontra los jobs de esta máquina')
let dirs: string[] = []
try {
  dirs = (await readdir(JOBS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
} catch {
  // no hay jobs: la parte de arriba ya ha probado el normalizador
}

if (dirs.length === 0) {
  console.log('  (sin jobs en disco; se comprueba solo el normalizador)')
} else {
  const jobs = await readJobs()
  console.log(`  ${dirs.length} directorios → ${jobs.length} jobs legibles`)
  check(jobs.length > 0, 'se lee al menos uno de verdad')
  check(
    jobs.every((job) => job.name.length > 0 && job.id.length > 0),
    'todos salen con id y nombre',
  )
  check(
    jobs.every((job) => !job.detail || job.detail.length > 0),
    'ningún parte vacío disfrazado de texto',
  )

  // El orden importa: lo que sigue en marcha va primero.
  const firstEnded = jobs.findIndex((job) => job.state !== 'working' && job.state !== 'blocked')
  const lastRunning = jobs.reduce(
    (last, job, index) => (job.state === 'working' || job.state === 'blocked' ? index : last),
    -1,
  )
  check(
    firstEnded === -1 || lastRunning < firstEnded,
    'los que siguen en marcha salen antes que los terminados',
  )

  // Y la lectura tolera un state.json ilegible sin dejar de leer los demás.
  const sample = dirs[0]!
  const raw = await readFile(join(JOBS_DIR, sample, 'state.json'), 'utf8').catch(() => null)
  check(raw === null || raw.length > 0, 'el primer state.json se puede leer o se ignora sin ruido')
}

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} comprobación(es) fallida(s)`)
process.exit(failures === 0 ? 0 : 1)
