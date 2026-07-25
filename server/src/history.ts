import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { CACHE_DIR, INDEX_CACHE } from './config.js'
import { readAgentMeta, scanSubagents, scanTranscripts } from './discover.js'
import { forEachLine, headLines, tailLines } from './lines.js'
import { TranscriptParser, type SessionHints } from './parser.js'
import { projectNameOf } from './roster.js'
import type { SessionInfo, TimelineEvent } from '../../shared/types.js'

/**
 * Índice del histórico. Escanear los 96 MB de transcripts en cada arranque sería absurdo,
 * así que de cada fichero se leen solo la cabeza y la cola, y el resultado se cachea con
 * clave (path, mtime, size).
 */

interface CacheEntry extends SessionInfo {
  mtimeMs: number
}

type Cache = Record<string, CacheEntry>

let cache: Cache | null = null

async function loadCache(): Promise<Cache> {
  if (cache) return cache
  try {
    cache = JSON.parse(await readFile(INDEX_CACHE, 'utf8')) as Cache
  } catch {
    cache = {}
  }
  return cache
}

async function saveCache(data: Cache): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(INDEX_CACHE, JSON.stringify(data), 'utf8')
  } catch {
    // sin caché seguimos funcionando, solo más lento
  }
}

function applyHints(info: SessionInfo, hints: SessionHints): void {
  if (hints.aiTitle) info.aiTitle = hints.aiTitle
  if (hints.gitBranch) info.gitBranch = hints.gitBranch
  if (hints.model) info.model = hints.model
  if (hints.permissionMode) info.permissionMode = hints.permissionMode
  if (hints.mode) info.mode = hints.mode
  if (hints.cwd && !info.cwd) info.cwd = hints.cwd
  if (hints.lastContextTokens) info.lastContextTokens = hints.lastContextTokens
}

/** Sesiones del histórico, más recientes primero. */
export async function listHistory(): Promise<SessionInfo[]> {
  const data = await loadCache()
  const files = await scanTranscripts()
  const out: SessionInfo[] = []
  let dirty = false

  for (const file of files) {
    if (file.agentId !== null) continue
    const cached = data[file.path]
    if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
      out.push(cached)
      continue
    }

    const info: SessionInfo = {
      sessionId: file.sessionId,
      cwd: '',
      project: '',
      slug: file.slug,
      transcriptPath: file.path,
      status: 'unknown',
      live: false,
      sizeBytes: file.sizeBytes,
    }

    const head = await headLines(file.path, 4)
    const tail = await tailLines(file.path, 40)
    const parser = new TranscriptParser({ sessionId: file.sessionId, agentId: null })
    for (const line of [...head, ...tail]) {
      const { hints } = parser.parse(line)
      applyHints(info, hints)
      if (hints.lastTs) {
        info.lastTs = hints.lastTs
        if (!info.firstTs) info.firstTs = hints.lastTs
      }
    }
    // El primer timestamp real es el de la cabeza; el bucle anterior lo fija ahí.
    info.project = info.cwd ? projectNameOf(info.cwd) : file.slug
    if (!info.aiTitle) info.aiTitle = basename(file.path, '.jsonl')

    const entry: CacheEntry = { ...info, mtimeMs: file.mtimeMs }
    data[file.path] = entry
    out.push(entry)
    dirty = true
  }

  if (dirty) await saveCache(data)
  out.sort((a, b) => (b.lastTs ?? '').localeCompare(a.lastTs ?? ''))
  return out
}

async function resolvePath(sessionId: string): Promise<{ path: string; slug: string } | null> {
  const data = await loadCache()
  for (const entry of Object.values(data)) {
    if (entry.sessionId === sessionId) return { path: entry.transcriptPath, slug: entry.slug }
  }
  for (const file of await scanTranscripts()) {
    if (file.agentId === null && file.sessionId === sessionId) {
      return { path: file.path, slug: file.slug }
    }
  }
  return null
}

export interface ReadOptions {
  from?: number
  limit?: number
  /** Intercalar los eventos de los subagentes, ordenados por timestamp. */
  includeAgents?: boolean
}

/** Eventos de una sesión histórica, paginados. */
export async function readSessionEvents(
  sessionId: string,
  opts: ReadOptions = {},
): Promise<{ events: TimelineEvent[]; total: number }> {
  const resolved = await resolvePath(sessionId)
  if (!resolved) return { events: [], total: 0 }

  const from = Math.max(0, opts.from ?? 0)
  const limit = Math.min(opts.limit ?? 500, 2000)

  const collected: TimelineEvent[] = []
  const parser = new TranscriptParser({ sessionId, agentId: null })
  await forEachLine(resolved.path, (line) => {
    for (const event of parser.parse(line).events) collected.push(event)
  })

  if (opts.includeAgents) {
    for (const ref of await scanSubagents(sessionId, resolved.slug)) {
      const meta = await readAgentMeta(ref.path)
      const agentParser = new TranscriptParser({ sessionId, agentId: ref.agentId })
      const actor = {
        id: ref.agentId as string,
        sessionId,
        kind: 'subagent' as const,
        agentType: meta.agentType,
        description: meta.description,
        depth: meta.spawnDepth ?? 1,
      }
      await forEachLine(ref.path, (line) => {
        for (const event of agentParser.parse(line).events) {
          event.actor = actor
          collected.push(event)
        }
      })
    }
    collected.sort((a, b) => a.ts.localeCompare(b.ts))
  }

  return { events: collected.slice(from, from + limit), total: collected.length }
}

/** Línea cruda de un evento, para el inspector (payloads de cientos de KB incluidos). */
export async function readRawEvent(sessionId: string, uuid: string): Promise<unknown | null> {
  const resolved = await resolvePath(sessionId)
  if (!resolved) return null
  const needle = `"uuid":"${uuid.split(':')[0]}"`
  let found: unknown = null

  const search = async (path: string): Promise<boolean> => {
    let hit = false
    await forEachLine(path, (line) => {
      if (!line.includes(needle)) return
      try {
        found = JSON.parse(line)
        hit = true
        return false
      } catch {
        return
      }
    })
    return hit
  }

  if (await search(resolved.path)) return found
  for (const ref of await scanSubagents(sessionId, resolved.slug)) {
    if (await search(ref.path)) return found
  }
  return null
}
