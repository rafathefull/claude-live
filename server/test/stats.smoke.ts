/**
 * Los resúmenes que compone el servidor no pueden llevar palabras fijas: el parser emite el
 * dato y el idioma se decide al pintarlo. Aquí se comprueba con los resultados que devuelven
 * de verdad las herramientas de Claude Code, y en los dos idiomas.
 *
 *   npm run test:stats
 */
import { describeToolInput, describeToolResult } from '../src/parser.js'
import { formatStat } from '../../shared/stats.js'
import { scanTranscripts } from '../src/discover.js'
import { forEachLine } from '../src/lines.js'
import { TranscriptParser } from '../src/parser.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

/** Un caso: el resultado tal como lo escribe Claude Code, y lo que debe leerse en cada idioma. */
const CASES: { what: string; tool: string; result: unknown; es: string; en: string }[] = [
  {
    what: 'Read',
    tool: 'Read',
    result: { type: 'text', file: { numLines: 74, totalLines: 148 } },
    es: '74 líneas de 148',
    en: '74 lines of 148',
  },
  { what: 'Read de una línea', tool: 'Read', result: { numLines: 1 }, es: '1 línea', en: '1 line' },
  {
    what: 'Grep',
    tool: 'Grep',
    result: { matches: ['a', 'b', 'c'] },
    es: '3 coincidencias',
    en: '3 matches',
  },
  { what: 'Grep con una', tool: 'Grep', result: { matches: ['a'] }, es: '1 coincidencia', en: '1 match' },
  { what: 'Glob', tool: 'Glob', result: { numFiles: 3 }, es: '3 ficheros', en: '3 files' },
  {
    what: 'Bash con salida',
    tool: 'Bash',
    result: { stdout: 'primera\nsegunda\ntercera', stderr: '' },
    es: 'primera (+2 líneas)',
    en: 'primera (+2 lines)',
  },
  {
    what: 'Bash sin salida',
    tool: 'Bash',
    result: { stdout: '', stderr: '' },
    es: 'sin salida',
    en: 'no output',
  },
  {
    what: 'Edit',
    tool: 'Edit',
    result: { structuredPatch: [{ lines: ['+uno', '+dos', '-tres'] }] },
    es: '+2 / −1',
    en: '+2 / −1',
  },
  {
    what: 'TaskCreate',
    tool: 'TaskCreate',
    result: { tasks: [{ id: '1' }, { id: '2' }] },
    es: '2 tareas',
    en: '2 tasks',
  },
  {
    what: 'Agent asíncrono',
    tool: 'Agent',
    result: { status: 'async_launched', agentId: 'a1b2' },
    es: 'lanzado (a1b2)',
    en: 'launched (a1b2)',
  },
  {
    what: 'AskUserQuestion',
    tool: 'AskUserQuestion',
    result: { answers: { '¿Idioma?': 'Los dos' } },
    es: 'elegido: Los dos',
    en: 'chosen: Los dos',
  },
]

console.log('resultados de herramientas, en los dos idiomas')
for (const testCase of CASES) {
  const { stat } = describeToolResult(testCase.tool, testCase.result)
  if (!stat) {
    failures++
    console.error(`  ✗ ${testCase.what}: no emite dato estructurado`)
    continue
  }
  const es = formatStat(stat, 'es')
  const en = formatStat(stat, 'en')
  check(es === testCase.es, `${testCase.what} · es → «${es}»`)
  check(en === testCase.en, `${testCase.what} · en → «${en}»`)
}

console.log('\nentradas de herramientas')
const updated = describeToolInput('TaskUpdate', { taskId: '7' })
check(
  updated.stat !== undefined && formatStat(updated.stat, 'en') === '#7 → updated',
  `TaskUpdate sin estado · en → «${updated.stat ? formatStat(updated.stat, 'en') : '—'}»`,
)
const asked = describeToolInput('AskUserQuestion', { questions: [{}, {}] })
check(
  asked.stat !== undefined && formatStat(asked.stat, 'es') === '2 preguntas',
  `AskUserQuestion sin texto · es → «${asked.stat ? formatStat(asked.stat, 'es') : '—'}»`,
)

// Y con transcripts reales: los resultados con unidades deben traer su dato.
console.log('\ncontra un transcript real')
const files = (await scanTranscripts())
  .filter((file) => file.agentId === null)
  .sort((a, b) => b.sizeBytes - a.sizeBytes)

if (files[0]) {
  const parser = new TranscriptParser({ sessionId: 'test', agentId: null })
  let withUnits = 0
  let withStat = 0
  await forEachLine(files[0].path, (line) => {
    for (const event of parser.parse(line).events) {
      if (event.kind !== 'tool_result') continue
      // Solo los resúmenes que compone el parser, y ancados al principio: un stderr ajeno puede
      // contener la palabra «línea» («/bin/bash: línea 8: …») sin ser un resumen con unidades, y
      // contarlo daba un falso positivo que acusaba al parser de algo que no hacía.
      if (event.isError) continue
      if (/^(\d[\d.,]*\s+(línea|coincidencia|fichero|tarea)|sin salida|lanzado |elegido:)/.test(event.summary)) {
        withUnits++
        if (event.stat) withStat++
      }
    }
  })
  console.log(`  ${withUnits} resultados con unidades, ${withStat} con dato estructurado`)
  check(withUnits > 0, 'el transcript tiene resultados con unidades')
  check(withStat === withUnits, 'todos llevan su dato, así que todos se traducen')
}

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} comprobación(es) fallida(s)`)
process.exit(failures === 0 ? 0 : 1)
