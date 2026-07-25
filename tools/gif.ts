/**
 * Graba el mundo de demostración y lo convierte en un GIF para el README.
 *
 * Reutiliza el mismo guion ficticio que `npm run demo` (un proyecto inventado, `tienda-api`,
 * con tres subagentes), así que no aparece nada tuyo. Playwright graba en vídeo y ffmpeg lo
 * pasa a GIF con paleta propia, que es lo que evita que se vea sucio.
 *
 *   npm run gif                       # docs/demo.gif
 *   npm run gif -- --out /tmp --width 700
 *
 * Requiere ffmpeg y los binarios de Chromium (npx playwright install chromium).
 */
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { buildDemoScript, playStep, writeDemoWorld } from './demo-data.js'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const outDir = arg('out', 'docs')
const name = arg('name', 'demo.gif')
const width = Number(arg('width', '900'))
const fps = Number(arg('fps', '10'))
const port = Number(arg('port', '7319'))
/** Colores de la paleta: la escena usa muy pocos, así que recortarla adelgaza el GIF. */
const colors = Number(arg('colors', '72'))
/** Milisegundos entre pasos del guion: más lento que en la demo, para que se vea el mundo. */
const stepMs = Number(arg('step', '520'))
const url = `http://127.0.0.1:${port}`
const viewport = { width: 1280, height: 720 }

const demoDir = await mkdtemp(join(tmpdir(), 'claude-live-gif-'))
const videoDir = await mkdtemp(join(tmpdir(), 'claude-live-video-'))
await mkdir(outDir, { recursive: true })

const { past, live } = buildDemoScript(Date.now() - 4 * 60 * 1000)
const world = await writeDemoWorld(demoDir, past)

try {
  await fetch(`${url}/api/health`)
  console.error(`el puerto ${port} está ocupado; usa --port`)
  process.exit(1)
} catch {
  // libre
}

const server = spawn(join('node_modules', '.bin', 'tsx'), ['server/src/index.ts'], {
  env: { ...process.env, CLAUDE_CONFIG_DIR: demoDir, CLAUDE_LIVE_PORT: String(port) },
  stdio: 'ignore',
  detached: true,
})

async function cleanup(): Promise<void> {
  try {
    if (server.pid) process.kill(-server.pid, 'SIGTERM')
  } catch {
    server.kill('SIGTERM')
  }
  await rm(demoDir, { recursive: true, force: true })
  await rm(videoDir, { recursive: true, force: true })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void cleanup().then(() => process.exit(1)))
}

let ready = false
for (let attempt = 0; attempt < 40 && !ready; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 500))
  try {
    ready = (await fetch(`${url}/api/health`)).ok
  } catch {
    ready = false
  }
}
if (!ready) {
  console.error('el servidor de demostración no arrancó')
  await cleanup()
  process.exit(1)
}

console.log('grabando el mundo…')
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport,
  locale: 'es-ES',
  recordVideo: { dir: videoDir, size: viewport },
})
const page = await context.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.locator('.stage canvas').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(2200)

for (const step of live) {
  await playStep(world, step)
  await new Promise((resolve) => setTimeout(resolve, stepMs))
}
// Un par de segundos de cierre, con los subagentes entregando su informe.
await page.waitForTimeout(2600)

await context.close()
await browser.close()

const videos = (await readdir(videoDir)).filter((file) => file.endsWith('.webm'))
if (videos.length === 0) {
  console.error('Playwright no dejó ningún vídeo')
  await cleanup()
  process.exit(1)
}
const video = join(videoDir, videos[0])
console.log(`vídeo: ${(((await stat(video)).size / 1024 / 1024)).toFixed(1)} MB`)

/** ffmpeg en dos pasadas: primero la paleta del propio vídeo, después el GIF. */
function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${code}`))))
    child.on('error', reject)
  })
}

const palette = join(videoDir, 'palette.png')
const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`
await ffmpeg([
  '-i',
  video,
  '-vf',
  `${filters},palettegen=max_colors=${colors}:stats_mode=diff`,
  palette,
])

const gif = join(outDir, name)
await ffmpeg([
  '-i',
  video,
  '-i',
  palette,
  '-lavfi',
  `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
  gif,
])

const size = (await stat(gif)).size / 1024 / 1024
console.log(
  `GIF → ${gif} · ${size.toFixed(1)} MB · ${width}px · ${fps} fps · ${colors} colores`,
)
if (size > 6) console.log('pesa bastante: prueba con --width 700, --fps 6 o --colors 48')

await cleanup()
