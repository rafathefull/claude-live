import type { Metrics, MetricsBucket } from '@shared/types'

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
  }
}

export function addBucket(target: MetricsBucket, source: MetricsBucket): MetricsBucket {
  return {
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
