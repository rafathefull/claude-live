import { stat } from 'node:fs/promises'
import { collectSessionEvents, resolveTranscript } from './history.js'
import { computeTiming, DEFAULT_PAUSE_MS, type TimingReport } from '../../shared/timing.js'

/**
 * Reparto del tiempo de una sesión, sobre su transcript completo (subagentes incluidos).
 *
 * La función que reparte vive en `shared/timing.ts`; aquí solo se le da la conversación entera,
 * que el front no tiene (en vivo guarda las últimas líneas), y se cachea por tamaño y fecha del
 * fichero: una sesión histórica no cambia, y una viva se recalcula solo cuando ha escrito algo.
 */

interface Cached {
  sizeBytes: number
  mtimeMs: number
  pauseMs: number
  report: TimingReport
}

const cache = new Map<string, Cached>()
/** Sesiones recordadas como mucho: el informe es pequeño, pero no hace falta guardar cientos. */
const CACHE_LIMIT = 64

export async function sessionTiming(
  sessionId: string,
  pauseMs = DEFAULT_PAUSE_MS,
): Promise<TimingReport | null> {
  const resolved = await resolveTranscript(sessionId)
  if (!resolved) return null

  let sizeBytes = 0
  let mtimeMs = 0
  try {
    const s = await stat(resolved.path)
    sizeBytes = s.size
    mtimeMs = s.mtimeMs
  } catch {
    return null
  }

  const hit = cache.get(sessionId)
  if (hit && hit.sizeBytes === sizeBytes && hit.mtimeMs === mtimeMs && hit.pauseMs === pauseMs) {
    return hit.report
  }

  const events = await collectSessionEvents(sessionId, true)
  if (!events) return null
  const report = computeTiming(events, { pauseMs })

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(sessionId, { sizeBytes, mtimeMs, pauseMs, report })
  return report
}
