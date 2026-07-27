/**
 * Abre claude-live en un Chromium sin ventana, recoge los errores de consola y guarda
 * capturas. Sirve para dos cosas: verificar que el mundo se renderiza de verdad (el
 * typecheck no detecta un fallo de la API de Pixi en runtime) y generar la imagen del README.
 *
 *   npm run screenshot                    # las tres vistas en el directorio por defecto
 *   npm run screenshot -- --out docs      # elegir destino
 *   npm run screenshot -- --url http://127.0.0.1:5173
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type ConsoleMessage, type Page } from 'playwright'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const url = arg('url', 'http://127.0.0.1:7317')
const outDir = arg('out', '/tmp/claude-live-shots')
const settleMs = Number(arg('settle', '5000'))

const problems: string[] = []

function watch(page: Page): void {
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`[${message.type()}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`))
  page.on('requestfailed', (request) =>
    problems.push(`[request] ${request.url()} — ${request.failure()?.errorText ?? 'falló'}`),
  )
}

async function shot(page: Page, name: string): Promise<void> {
  const path = join(outDir, `${name}.png`)
  await page.screenshot({ path })
  console.log(`  captura → ${path}`)
}

await mkdir(outDir, { recursive: true })

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
watch(page)

console.log(`abriendo ${url}`)
const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
console.log(`  HTTP ${response?.status()}`)

// 1. Vista en directo: debe existir el canvas de Pixi.
const canvas = page.locator('.stage canvas')
const hasCanvas = await canvas
  .waitFor({ state: 'visible', timeout: 10_000 })
  .then(() => true)
  .catch(() => false)
console.log(`  canvas del mundo: ${hasCanvas ? 'presente' : 'NO APARECE'}`)
if (hasCanvas) {
  const box = await canvas.boundingBox()
  console.log(`  tamaño del canvas: ${box?.width}×${box?.height}`)
}
await page.waitForTimeout(settleMs)
await shot(page, '1-directo')

// 2. Leyenda.
await page.getByRole('button', { name: /Leyenda/ }).click()
await page.locator('.legend').waitFor({ state: 'visible', timeout: 5000 })
await page.waitForTimeout(400)
await shot(page, '2-leyenda')
await page.keyboard.press('Escape')

// 3. Reproductor: se abre la conversación del historial con más eventos.
await page.getByRole('button', { name: 'Historial' }).click()
await page.locator('.history table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 })
const rows = await page.locator('.history table tbody tr').count()
console.log(`  sesiones en el historial: ${rows}`)

// Las sesiones vivas salen primero y para ellas no hay reproductor (se ven en directo),
// así que hay que elegir una fila del historial: la primera sin indicador de «viva».
const historic = page.locator('.history table tbody tr').filter({ hasNot: page.locator('.dot') })
console.log(`  de ellas, históricas: ${await historic.count()}`)
await historic.first().click()
const bar = page.locator('.replay-bar')
const hasBar = await bar
  .waitFor({ state: 'visible', timeout: 15_000 })
  .then(() => true)
  .catch(() => false)
console.log(`  barra del reproductor: ${hasBar ? 'presente' : 'NO APARECE'}`)

if (hasBar) {
  await page.locator('.replay-speeds button', { hasText: '8×' }).click()
  await page.waitForTimeout(settleMs + 3000)
  const counter = await page.locator('.replay-count').textContent()
  console.log(`  progreso del replay: ${counter?.trim()}`)
  await shot(page, '3-replay')
}

await browser.close()

console.log(
  problems.length === 0
    ? '\nSin errores de consola'
    : `\n${problems.length} aviso(s) de la página:`,
)
for (const problem of [...new Set(problems)].slice(0, 25)) console.log(`  ${problem}`)
