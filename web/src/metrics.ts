import type { Metrics, MetricsBucket, Pricing } from '@shared/types'

/**
 * Filtrado y agregación de las métricas para la vista.
 *
 * Vive fuera del componente para poder probarlo en Node. Lo delicado aquí son dos cosas: la
 * serie de días tiene que incluir **los días sin actividad** —si no, una semana de vacaciones
 * se dibuja como si hubieras trabajado sin parar— y el rango se cuenta desde el último día con
 * datos, no desde hoy, para que el histórico ya recortado por la limpieza de Claude Code no
 * salga como una gráfica vacía.
 */

export const ALL_PROJECTS = '*'

export interface DayPoint {
  day: string
  bucket: MetricsBucket
}

export function emptyBucket(): MetricsBucket {
  return {
    sessions: 0,
    events: 0,
    toolCalls: 0,
    errors: 0,
    prompts: 0,
    agents: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCache: 0,
    bytes: 0,
    modelTokens: {},
  }
}

export function addBucket(target: MetricsBucket, source: MetricsBucket): MetricsBucket {
  const modelTokens: MetricsBucket['modelTokens'] = {}
  for (const from of [target.modelTokens, source.modelTokens]) {
    for (const [model, usage] of Object.entries(from ?? {})) {
      const into = (modelTokens[model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })
      into.input += usage.input
      into.output += usage.output
      into.cacheRead += usage.cacheRead
      into.cacheCreate += usage.cacheCreate
    }
  }
  return {
    modelTokens,
    sessions: target.sessions + source.sessions,
    events: target.events + source.events,
    toolCalls: target.toolCalls + source.toolCalls,
    errors: target.errors + source.errors,
    prompts: target.prompts + source.prompts,
    agents: target.agents + source.agents,
    tokensIn: target.tokensIn + source.tokensIn,
    tokensOut: target.tokensOut + source.tokensOut,
    tokensCache: target.tokensCache + source.tokensCache,
    bytes: target.bytes + source.bytes,
  }
}

/** Día siguiente en `AAAA-MM-DD`, con UTC para no depender de la zona horaria. */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Serie de días para el proyecto y el rango pedidos, con los huecos rellenos a cero.
 * `days = 0` significa todo el histórico disponible.
 */
export function series(metrics: Metrics, project: string, days: number): DayPoint[] {
  const source = project === ALL_PROJECTS ? metrics.byDay : (metrics.projectDays[project] ?? {})
  const keys = Object.keys(source).sort()
  if (keys.length === 0) return []

  const last = keys[keys.length - 1]!
  let first = keys[0]!
  if (days > 0) {
    // Desde el último día con datos hacia atrás: contar desde hoy dejaría la gráfica vacía
    // cuando la limpieza de Claude Code ya se ha llevado lo reciente.
    const from = new Date(`${last}T00:00:00.000Z`)
    from.setUTCDate(from.getUTCDate() - (days - 1))
    const limit = from.toISOString().slice(0, 10)
    if (limit > first) first = limit
  }

  const out: DayPoint[] = []
  for (let day = first; day <= last; day = nextDay(day)) {
    out.push({ day, bucket: source[day] ?? emptyBucket() })
  }
  return out
}

/** Suma de una serie: lo que se enseña como total del rango elegido. */
export function totals(points: readonly DayPoint[]): MetricsBucket {
  return points.reduce((acc, point) => addBucket(acc, point.bucket), emptyBucket())
}

/** Las claves más usadas de un mapa de recuentos, en orden. */
export function top(counts: Record<string, number>, limit = 8): { key: string; n: number }[] {
  return Object.entries(counts)
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1))
    .slice(0, limit)
}

/** Qué se dibuja en la gráfica. */
export type Measure = 'events' | 'toolCalls' | 'tokens' | 'sessions' | 'errors'

export function valueOf(bucket: MetricsBucket, measure: Measure): number {
  switch (measure) {
    case 'events':
      return bucket.events
    case 'toolCalls':
      return bucket.toolCalls
    case 'tokens':
      return bucket.tokensIn + bucket.tokensOut
    case 'sessions':
      return bucket.sessions
    case 'errors':
      return bucket.errors
  }
}

/**
 * Coste del tramo según las tarifas, que van por millón de tokens.
 *
 * Devuelve `null` cuando no hay tarifas —lo normal con una suscripción, donde no se paga por
 * uso— para que la interfaz no muestre un cero que parecería un dato. Un modelo sin tarifa
 * propia usa la entrada `default` si existe; si no, no se cobra y se cuenta como no tarifado,
 * porque callarlo daría una cifra baja sin decir por qué.
 */
export interface Cost {
  total: number
  currency: string
  /** Modelos sin tarifa: su consumo no está en el total. */
  untariffed: string[]
}

export function costOf(bucket: MetricsBucket, pricing: Pricing | null): Cost | null {
  if (!pricing) return null
  let total = 0
  const untariffed: string[] = []
  for (const [model, usage] of Object.entries(bucket.modelTokens ?? {})) {
    const rate = pricing.models[model] ?? pricing.models.default
    if (!rate) {
      if (usage.input + usage.output + usage.cacheRead + usage.cacheCreate > 0) {
        untariffed.push(model)
      }
      continue
    }
    total +=
      (usage.input / 1e6) * rate.input +
      (usage.output / 1e6) * rate.output +
      (usage.cacheRead / 1e6) * rate.cacheRead +
      (usage.cacheCreate / 1e6) * rate.cacheWrite
  }
  return { total, currency: pricing.currency, untariffed: untariffed.sort() }
}

/** Con céntimos si es poco dinero, sin ellos si es mucho: 0,42 € y 1.284 € se leen distinto. */
export function formatMoney(cost: Cost): string {
  const value = cost.total
  const digits = value >= 100 ? 0 : value >= 1 ? 2 : 3
  return `${value.toFixed(digits)} ${cost.currency}`
}
