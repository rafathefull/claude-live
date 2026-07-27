/**
 * Siembra un `~/.claude` sintético con el guion de la demostración, para que las pruebas que
 * necesitan transcripts reales tengan algo que morder donde no hay una máquina con historia
 * (la integración continua, un portátil recién estrenado).
 *
 *   npx tsx tools/seed.ts /tmp/claude-live-ci
 *   CLAUDE_CONFIG_DIR=/tmp/claude-live-ci npm test
 *
 * No sustituye a las pruebas con tus propios transcripts: los datos de la demo son amables y
 * los tuyos no. Es un suelo mínimo, no un sustituto.
 */
import { rm } from 'node:fs/promises'
import { buildDemoScript, playStep, writeDemoWorld } from './demo-data.js'

const dir = process.argv[2] ?? '/tmp/claude-live-ci'
await rm(dir, { recursive: true, force: true })

// Cuatro minutos de conversación «ya ocurrida»: el guion entero, sin esperas.
const { past, live } = buildDemoScript(Date.now() - 4 * 60 * 1000)
const world = await writeDemoWorld(dir, past)
for (const step of live) await playStep(world, step)

console.log(`sembrado en ${dir}: ${past.length + live.length} eventos`)
console.log(`  CLAUDE_CONFIG_DIR=${dir} npm test`)
