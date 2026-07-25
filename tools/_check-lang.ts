/** Temporal: resúmenes en los dos idiomas contra el servidor de demostración. */
import { chromium } from 'playwright'
const url = process.argv[2] ?? 'http://127.0.0.1:7318'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 860 }, locale: 'es-ES' })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.locator('.timeline-list .row').first().waitFor({ timeout: 20_000 })
await page.waitForTimeout(2000)
const pick = async () =>
  (await page.locator('.timeline-list .row .summary').allTextContents())
    .map((r) => r.trim())
    .filter((r) => /(línea|line|coincidenc|match|fichero|file|tarea|task|salida|output|lanzad|launch|element)/i.test(r))
    .slice(0, 6)
console.log('castellano:'); for (const r of await pick()) console.log(`  ${r}`)
await page.locator('.lang-switch button', { hasText: 'EN' }).click()
await page.waitForTimeout(1800)
console.log('\ninglés:'); for (const r of await pick()) console.log(`  ${r}`)
await browser.close()
