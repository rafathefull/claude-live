import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CACHE_DIR } from './config.js'
import type { ModelRate, Pricing } from '../../shared/types.js'

/**
 * Tarifas por millón de tokens, opcionales.
 *
 * Con una suscripción de Claude no se paga por uso: Claude Code mismo declara `costUSD: 0` en su
 * `stats-cache.json`. Así que aquí no hay precios de fábrica —quedarían obsoletos y darían una
 * cifra falsa—: quien pague por API pone su fichero y entonces, y solo entonces, el visor habla de dinero.
 *
 * Se busca en `$CLAUDE_LIVE_PRICING` o en `<datos>/claude-live/pricing.json`. Hay un ejemplo en
 * `docs/pricing.example.json`.
 */

export const PRICING_PATH = process.env.CLAUDE_LIVE_PRICING ?? join(CACHE_DIR, 'pricing.json')

let cached: { mtimeMs: number; pricing: Pricing | null } | null = null

function rate(raw: unknown): ModelRate | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const num = (value: unknown): number => (typeof value === 'number' && value >= 0 ? value : 0)
  const model: ModelRate = {
    input: num(o.input),
    output: num(o.output),
    cacheRead: num(o.cacheRead),
    cacheWrite: num(o.cacheWrite),
  }
  // Un modelo con todo a cero no aporta nada y solo ensucia la tabla.
  return model.input || model.output || model.cacheRead || model.cacheWrite ? model : null
}

/** Lee las tarifas si las hay. Tolerante: un fichero a medio escribir no rompe las métricas. */
export async function readPricing(): Promise<Pricing | null> {
  let mtimeMs: number
  try {
    mtimeMs = (await stat(PRICING_PATH)).mtimeMs
  } catch {
    cached = null
    return null // no hay tarifas: no se habla de dinero
  }
  if (cached && cached.mtimeMs === mtimeMs) return cached.pricing

  let pricing: Pricing | null = null
  try {
    const raw = JSON.parse(await readFile(PRICING_PATH, 'utf8')) as Record<string, unknown>
    const models: Record<string, ModelRate> = {}
    for (const [model, value] of Object.entries((raw.models ?? {}) as Record<string, unknown>)) {
      const parsed = rate(value)
      if (parsed) models[model] = parsed
    }
    if (Object.keys(models).length > 0) {
      pricing = {
        currency: typeof raw.currency === 'string' ? raw.currency : 'USD',
        models,
        source: PRICING_PATH,
      }
    }
  } catch {
    pricing = null
  }

  cached = { mtimeMs, pricing }
  return pricing
}
