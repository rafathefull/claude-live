/**
 * Monta el mundo de demostración y saca las capturas del README.
 *
 * Arranca un servidor aparte apuntando a un `~/.claude` ficticio (CLAUDE_CONFIG_DIR), va
 * escribiendo el guion mientras el navegador mira, y captura el mundo en plena faena. No
 * toca tu configuración ni tus transcripts.
 *
 *   npm run demo                      # capturas en docs/
 *   npm run demo -- --out /tmp/x      # otro destino
 *   npm run demo -- --keep            # deja el servidor vivo para mirarlo tú
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { buildDemoScript, playStep, writeDemoWorld } from './demo-data.js'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const keep = process.argv.includes('--keep')
const outDir = arg('out', 'docs')
const port = Number(arg('port', '7318'))
const url = `http://127.0.0.1:${port}`

const demoDir = await mkdtemp(join(tmpdir(), 'claude-live-demo-'))
await mkdir(outDir, { recursive: true })

// El guion arranca «hace un rato» para que los tiempos de la timeline sean creíbles.
const { past, live } = buildDemoScript(Date.now() - 4 * 60 * 1000)
const world = await writeDemoWorld(demoDir, past)
console.log(`mundo de demostración en ${demoDir}`)

// Si el puerto ya responde, hay un servidor de una ejecución anterior: sus datos apuntan a
// un directorio que ya no existe y la demo saldría vacía.
try {
  await fetch(`${url}/api/health`)
  console.error(`el puerto ${port} ya está ocupado; ciérralo o usa --port`)
  await rm(demoDir, { recursive: true, force: true })
  process.exit(1)
} catch {
  // libre, seguimos
}

// `detached` crea un grupo de procesos para poder matar también a los hijos: matar solo al
// lanzador dejaba el servidor vivo ocupando el puerto.
const server = spawn(join('node_modules', '.bin', 'tsx'), ['server/src/index.ts'], {
  env: { ...process.env, CLAUDE_CONFIG_DIR: demoDir, CLAUDE_LIVE_PORT: String(port) },
  stdio: 'ignore',
  detached: true,
})

async function waitForServer(): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) return true
    } catch {
      // todavía no escucha
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

async function cleanup(): Promise<void> {
  try {
    if (server.pid) process.kill(-server.pid, 'SIGTERM')
  } catch {
    server.kill('SIGTERM')
  }
  await rm(demoDir, { recursive: true, force: true })
}

// Un Ctrl+C tampoco debe dejar el servidor colgado.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void cleanup().then(() => process.exit(1)))
}

if (!(await waitForServer())) {
  console.error('el servidor de demostración no arrancó')
  await cleanup()
  process.exit(1)
}

const problems: string[] = []
const browser = await chromium.launch()
// `colorScheme` explícito: Chromium sin ventana prefiere el tema claro, y las capturas del
// README son las del tema oscuro.
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  colorScheme: 'dark',
  // El idioma se detecta del navegador, y el de la integración continua habla inglés: sin
  // fijarlo, las capturas salían traducidas a medias según quién las generase.
  locale: 'es-ES',
})
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`[error] ${message.text()}`)
})

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.locator('.stage canvas').waitFor({ state: 'visible', timeout: 15_000 })
await page.waitForTimeout(2500)

// Ahora el guion «en directo»: el visor lo va detectando por el watcher.
console.log(`representando ${live.length} pasos en vivo`)
for (const step of live) {
  await playStep(world, step)
  await new Promise((resolve) => setTimeout(resolve, 320))
}
await page.waitForTimeout(2200)

const health = (await (await fetch(`${url}/api/health`)).json()) as { sessions: number }
const eventos = await page.locator('.timeline-head .muted').textContent()
const agentes = await page.locator('.agent-legend .agent-pill').count()
console.log(`  sesiones detectadas: ${health.sessions} · ${eventos?.trim()} · ${agentes} actores en la leyenda`)

await page.screenshot({ path: join(outDir, 'preview.png') })
console.log(`  captura → ${join(outDir, 'preview.png')}`)

await page.getByRole('button', { name: /Leyenda|Legend/ }).click()
await page.locator('.legend').waitFor({ state: 'visible' })
await page.waitForTimeout(400)
await page.screenshot({ path: join(outDir, 'leyenda.png') })
console.log(`  captura → ${join(outDir, 'leyenda.png')}`)

// La leyenda es más alta que la ventana: hay que poder llegar hasta el final.
const scroll = await page.locator('.legend-body').evaluate((el) => ({
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
}))
await page.locator('.legend-body').evaluate((el) => el.scrollTo(0, el.scrollHeight))
await page.waitForTimeout(300)
const bottom = await page.locator('.legend-body').evaluate((el) => el.scrollTop + el.clientHeight)
const reachable = bottom >= scroll.scrollHeight - 2
console.log(
  `  leyenda: ${scroll.clientHeight}px visibles de ${scroll.scrollHeight}px · final alcanzable: ${reachable ? 'sí' : 'NO'}`,
)
await page.screenshot({ path: join(outDir, 'leyenda-habitantes.png') })
console.log(`  captura → ${join(outDir, 'leyenda-habitantes.png')}`)
await page.keyboard.press('Escape')

// Redimensionado: las estaciones se recolocan con la ventana, así que los actores tienen que
// seguirlas. Antes se quedaban en su píxel y acababan plantados en medio de otra estación.
for (const size of [
  { width: 1024, height: 660, name: 'estrecho' },
  { width: 1600, height: 900, name: 'ancho' },
]) {
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.waitForTimeout(1500)
  const path = join(outDir, `preview-${size.name}.png`)
  await page.screenshot({ path })
  console.log(`  captura → ${path} (${size.width}×${size.height})`)
}

// Histórico en árbol: la vista que agrupa las sesiones por proyecto.
await page.getByRole('button', { name: /Historial|History/ }).click()
await page.locator('.history').waitFor({ state: 'visible' })
await page.waitForTimeout(800)
await page.getByRole('button', { name: /Árbol|Tree/ }).click()
await page.getByRole('button', { name: /Abrir todo|Expand all/ }).click()
await page.waitForTimeout(400)
const proyectos = await page.locator('.tree-node').count()
const hojas = await page.locator('.tree-node li').count()
console.log(`  árbol del histórico: ${proyectos} proyectos, ${hojas} sesiones`)
await page.screenshot({ path: join(outDir, 'arbol.png') })
console.log(`  captura → ${join(outDir, 'arbol.png')}`)

// Y el mismo mundo en tema claro.
await page.getByRole('button', { name: /En vivo|Live/ }).click()
await page.waitForTimeout(1200)
await page.locator('.theme-toggle').click()
await page.waitForTimeout(2200)
const claro = await page.evaluate(() => document.documentElement.dataset.theme)
if (claro !== 'light') throw new Error(`el botón del tema no dejó la página en claro: ${claro}`)
console.log(`  tema aplicado: ${claro}`)
await page.screenshot({ path: join(outDir, 'preview-claro.png') })
console.log(`  captura → ${join(outDir, 'preview-claro.png')}`)
await page.locator('.theme-toggle').click()
await page.waitForTimeout(1200)

await page.locator('.timeline-head button', { hasText: /pensamiento|thinking/ }).waitFor()
await browser.close()

if (keep) {
  // `unref` suelta el hijo del bucle de eventos: sin esto el proceso no terminaba nunca y el
  // terminal se quedaba colgado, aunque el trabajo ya estuviera hecho. El servidor sigue vivo
  // por su cuenta (es un grupo de procesos aparte), así que hay que decir cómo pararlo.
  server.unref()
  console.log(`\nservidor de demostración en ${url}, sigue vivo en segundo plano`)
  console.log(`  para pararlo:  kill -TERM -${server.pid}`)
  console.log(`  datos en:      ${demoDir}  (bórralo cuando acabes)`)
} else {
  await cleanup()
}

console.log(problems.length === 0 ? '\nSin errores de consola' : `\n${problems.length} error(es):`)
for (const problem of [...new Set(problems)].slice(0, 20)) console.log(`  ${problem}`)

// Un error de consola es un fallo, no una nota al pie: así la integración continua se entera.
if (problems.length > 0) process.exit(1)
