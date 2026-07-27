import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_DIR } from './config.js'
import { scanTranscripts } from './discover.js'
import { forEachLine } from './lines.js'

/**
 * Cuánta historia queda y cuánta se ha ido.
 *
 * Claude Code borra los transcripts pasados `cleanupPeriodDays` (30 por defecto), así que el
 * historial del visor no es todo lo que has hecho: es lo que sobrevive. El registro de prompts
 * de `~/.claude/history.jsonl` conserva el `sessionId` de sesiones cuyo transcript ya no está,
 * y comparar las dos listas da la medida exacta de lo perdido.
 */

export interface RetentionInfo {
  /** Sesiones con transcript disponible. */
  onDisk: number
  /** Sesiones de las que hay constancia en el registro de prompts. */
  known: number
  /** Las que ya no tienen transcript: `known - onDisk` acotado a cero. */
  missing: number
  /** Días configurados en settings.json, si están; si no, el valor por defecto. */
  cleanupPeriodDays: number
  /** true si el valor viene de settings.json y no del defecto. */
  configured: boolean
  /** Fecha del transcript más antiguo que queda (ISO). */
  oldest?: string
}

const DEFAULT_CLEANUP_DAYS = 30
/** El cálculo no cambia de un minuto a otro: se cachea un rato. */
const TTL_MS = 5 * 60 * 1000

let cached: { at: number; info: RetentionInfo } | null = null

async function readCleanupDays(): Promise<{ days: number; configured: boolean }> {
  for (const file of ['settings.json', 'settings.local.json']) {
    try {
      const raw = JSON.parse(await readFile(join(CLAUDE_DIR, file), 'utf8')) as {
        cleanupPeriodDays?: unknown
      }
      if (typeof raw.cleanupPeriodDays === 'number' && raw.cleanupPeriodDays > 0) {
        return { days: raw.cleanupPeriodDays, configured: true }
      }
    } catch {
      // sin fichero o ilegible: se prueba el siguiente
    }
  }
  return { days: DEFAULT_CLEANUP_DAYS, configured: false }
}

export async function retentionInfo(): Promise<RetentionInfo> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.info

  const files = (await scanTranscripts()).filter((file) => file.agentId === null)
  const onDiskIds = new Set(files.map((file) => file.sessionId))

  let oldest: number | undefined
  for (const file of files) {
    if (oldest === undefined || file.mtimeMs < oldest) oldest = file.mtimeMs
  }

  // Sesiones de las que hay constancia, tengan o no transcript.
  const knownIds = new Set<string>()
  try {
    await stat(join(CLAUDE_DIR, 'history.jsonl'))
    await forEachLine(join(CLAUDE_DIR, 'history.jsonl'), (line) => {
      try {
        const row = JSON.parse(line) as { sessionId?: unknown }
        if (typeof row.sessionId === 'string') knownIds.add(row.sessionId)
      } catch {
        // línea corrupta: se ignora
      }
    })
  } catch {
    // sin registro de prompts: solo se puede informar de lo que hay en disco
  }
  for (const id of onDiskIds) knownIds.add(id)

  const { days, configured } = await readCleanupDays()
  const info: RetentionInfo = {
    onDisk: onDiskIds.size,
    known: knownIds.size,
    missing: Math.max(0, knownIds.size - onDiskIds.size),
    cleanupPeriodDays: days,
    configured,
    oldest: oldest ? new Date(oldest).toISOString() : undefined,
  }
  cached = { at: Date.now(), info }
  return info
}
