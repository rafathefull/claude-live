/**
 * Regresión con datos reales (sin mocks): se alimenta el parser con los transcripts más
 * hostiles de esta máquina y se comprueba que no lanza, que no se come la memoria y que
 * los payloads salen recortados.
 *
 *   npm run test:parser
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_PAYLOAD_BYTES, PROJECTS_DIR } from '../src/config.js'
import { parseTranscriptPath, scanTranscripts } from '../src/discover.js'
import { forEachLine } from '../src/lines.js'
import { TranscriptParser } from '../src/parser.js'
import type { EventKind } from '../../shared/types.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`)
  } else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

async function runFile(path: string, agentId: string | null): Promise<void> {
  const size = (await stat(path)).size
  const parser = new TranscriptParser({ sessionId: 'test', agentId })
  const counts = new Map<EventKind, number>()
  let lines = 0
  let maxPayload = 0
  let maxSummary = 0
  let oversized = 0
  const started = process.hrtime.bigint()

  await forEachLine(path, (line) => {
    lines++
    const result = parser.parse(line)
    for (const event of result.events) {
      counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
      const json = JSON.stringify(event.payload ?? '')
      maxPayload = Math.max(maxPayload, json.length)
      maxSummary = Math.max(maxSummary, event.summary.length)
      // El límite se comprueba sobre la forma serializada, que es lo que viaja por SSE.
      if (json.length > MAX_PAYLOAD_BYTES + 8) oversized++
    }
  })

  const ms = Number(process.hrtime.bigint() - started) / 1e6
  const heapMb = process.memoryUsage().heapUsed / 1024 / 1024
  const summary = [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(' ')

  console.log(`\n${path.replace(PROJECTS_DIR, '…')}`)
  console.log(
    `  ${(size / 1024 / 1024).toFixed(1)} MB · ${lines} líneas · ${ms.toFixed(0)} ms · heap ${heapMb.toFixed(0)} MB`,
  )
  console.log(`  eventos: ${summary || '(ninguno)'}`)
  check(oversized === 0, `ningún payload supera el recorte (máx ${maxPayload} bytes)`)
  check(maxSummary <= 181, `los resúmenes caben en una línea (máx ${maxSummary} caracteres)`)
  check(lines > 0, 'el fichero tenía líneas')
}

const files = await scanTranscripts()
const mains = files.filter((f) => f.agentId === null).sort((a, b) => b.sizeBytes - a.sizeBytes)
const agents = files.filter((f) => f.agentId !== null).sort((a, b) => b.sizeBytes - a.sizeBytes)

console.log(`Transcripts encontrados: ${mains.length} sesiones, ${agents.length} subagentes`)

if (mains[0]) await runFile(mains[0].path, null) // el más grande
if (mains[1]) await runFile(mains[1].path, null)
if (agents[0]) await runFile(agents[0].path, agents[0].agentId)

// El reconocimiento de rutas debe funcionar con los nombres reales, incluidos los slugs
// con caracteres no ASCII (p. ej. "Diseño en pantalla" → "Dise-o-en-pantalla").
console.log('\nreconocimiento de rutas')
const slugs = await readdir(PROJECTS_DIR)
check(slugs.length > 0, `hay ${slugs.length} directorios de proyecto`)
check(
  parseTranscriptPath(join(PROJECTS_DIR, 'x', '00000000-0000-4000-8000-000000000000.jsonl'))
    ?.agentId === null,
  'transcript principal reconocido',
)
check(
  parseTranscriptPath(
    join(PROJECTS_DIR, 'x', '00000000-0000-4000-8000-000000000000', 'subagents', 'agent-abc.jsonl'),
  )?.agentId === 'abc',
  'transcript de subagente reconocido',
)
check(parseTranscriptPath(join(PROJECTS_DIR, 'x', 'notes.txt')) === null, 'no-transcript descartado')

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} comprobación(es) fallida(s)`)
process.exit(failures === 0 ? 0 : 1)
