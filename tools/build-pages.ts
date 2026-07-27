/**
 * Construye la versión de GitHub Pages: el visor entero, sin servidor, con un mundo inventado
 * dentro de un JSON.
 *
 * Los datos NO salen de tu `~/.claude` —ahí está tu código y tus prompts—, sino del mismo guion
 * de demostración que usa `npm run demo`, escrito en un directorio temporal y leído con el
 * pipeline real del servidor. Así lo que se publica pasa por el mismo parser que lo de verdad.
 *
 *   npm run build:pages          # deja pages-dist/ listo para publicar
 *   npm run build:pages -- --base /            # sin subdirectorio (para servirlo en la raíz)
 */
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const base = arg('base', '/claude-live/')
const outDir = arg('out', 'pages-dist')

// El directorio de configuración se resuelve al importar los módulos del servidor, así que se
// prepara ANTES de cargarlos: de ahí los imports dinámicos de más abajo.
const demoDir = await mkdtemp(join(tmpdir(), 'claude-live-pages-'))
process.env.CLAUDE_CONFIG_DIR = demoDir
// Y sin tarifas: la demostración no debe hablar de dinero, que con suscripción no se paga por uso.
delete process.env.CLAUDE_LIVE_PRICING

const { buildDemoScript, playStep, writeDemoWorld } = await import('./demo-data.js')
const { listHistory, readSessionEvents } = await import('../server/src/history.js')
const { readJobs } = await import('../server/src/jobs.js')
const { computeMetrics } = await import('../server/src/metrics.js')
const { retentionInfo } = await import('../server/src/retention.js')

console.log(`mundo de demostración en ${demoDir}`)
const startedAt = Date.parse('2026-07-27T09:12:00.000Z')
const { past, live } = buildDemoScript(startedAt)
const world = await writeDemoWorld(demoDir, past)
for (const step of live) await playStep(world, step)

// El índice del histórico y los eventos de cada sesión, con el parser de verdad.
const sessions = await listHistory()
const events: Record<string, unknown[]> = {}
const agents = new Map<string, unknown>()
for (const session of sessions) {
  const page = await readSessionEvents(session.sessionId, { limit: 2000, includeAgents: true })
  events[session.sessionId] = page.events
  for (const event of page.events) {
    if (event.actor && event.agentId) agents.set(event.actor.id, { ...event.actor, done: true })
  }
}

const jobs = await readJobs()
const metrics = await computeMetrics({ force: true })
const retention = await retentionInfo()

// La sesión que hace de «en directo» es la del guion, y se emite desde el final de su parte
// pasada: al abrir la página se ve el mundo ya poblado y a Claude trabajando, no un escenario
// vacío durante medio minuto.
const liveSession = sessions.find((session) => session.sessionId === world.sessionId)
if (!liveSession) throw new Error('el mundo de demostración no dejó ninguna sesión')
const fromIndex = Math.max(0, (events[liveSession.sessionId]?.length ?? 0) - live.length)

// El índice del histórico no marca sesiones vivas —eso lo hace el registro en vivo leyendo el
// roster, y aquí no hay proceso que mirar—, así que se marca la del guion a mano: sin una sesión
// viva, el HUD y el vecindario saldrían vacíos y no habría nada que enseñar.
const withLive = sessions.map((session) =>
  session.sessionId === liveSession.sessionId
    ? { ...session, live: true, status: 'busy' as const, pid: 4242, name: 'demo' }
    : session,
)

const demo = {
  sessions: withLive,
  agents: [...agents.values()],
  jobs,
  events,
  metrics,
  retention,
  live: { sessionId: liveSession.sessionId, fromIndex },
}

console.log(
  `  ${sessions.length} sesiones · ${Object.values(events).reduce((n, list) => n + list.length, 0)} eventos · ` +
    `${jobs.length} jobs · ${Object.keys(metrics.byProject).length} proyectos`,
)

// Vite construye el front con la bandera de modo estático; los datos se copian después.
const vite = spawnSync(
  join('node_modules', '.bin', 'vite'),
  ['build', '--base', base, '--outDir', join('..', outDir), '--emptyOutDir'],
  { stdio: 'inherit', env: { ...process.env, VITE_STATIC: '1' } },
)
if (vite.status !== 0) {
  await rm(demoDir, { recursive: true, force: true })
  process.exit(vite.status ?? 1)
}

await mkdir(join(outDir, 'data'), { recursive: true })
const json = JSON.stringify(demo)
await writeFile(join(outDir, 'data', 'demo.json'), json, 'utf8')
// GitHub Pages no sirve rutas que no existan: sin esto, recargar con una ruta profunda daría 404.
await writeFile(join(outDir, '.nojekyll'), '', 'utf8')

await rm(demoDir, { recursive: true, force: true })
console.log(`\n${outDir}/ listo · datos ${(json.length / 1024).toFixed(0)} KB · base ${base}`)
