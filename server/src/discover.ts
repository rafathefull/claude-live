import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { PROJECTS_DIR } from './config.js'

/**
 * Rutas de los transcripts, tal como las escribe Claude Code:
 *
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl
 *   ~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl
 *   ~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.meta.json
 *   ~/.claude/projects/<slug>/<sessionId>/tool-results/<id>.txt
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TranscriptRef {
  path: string
  sessionId: string
  /** null = transcript de la sesión principal. */
  agentId: string | null
  slug: string
}

export function parseTranscriptPath(path: string): TranscriptRef | null {
  if (!path.startsWith(PROJECTS_DIR) || !path.endsWith('.jsonl')) return null
  const rel = path.slice(PROJECTS_DIR.length + 1)
  const parts = rel.split(sep)

  // <slug>/<sessionId>.jsonl
  if (parts.length === 2) {
    const sessionId = parts[1].replace(/\.jsonl$/, '')
    if (!UUID_RE.test(sessionId)) return null
    return { path, sessionId, agentId: null, slug: parts[0] }
  }

  // <slug>/<sessionId>/subagents/agent-<agentId>.jsonl
  if (parts.length === 4 && parts[2] === 'subagents') {
    const sessionId = parts[1]
    const file = basename(parts[3], '.jsonl')
    if (!UUID_RE.test(sessionId) || !file.startsWith('agent-')) return null
    return { path, sessionId, agentId: file.slice('agent-'.length), slug: parts[0] }
  }

  return null
}

export interface AgentMeta {
  agentType?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number
}

export async function readAgentMeta(transcriptPath: string): Promise<AgentMeta> {
  const metaPath = join(
    dirname(transcriptPath),
    `${basename(transcriptPath, '.jsonl')}.meta.json`,
  )
  try {
    const raw = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
    return {
      agentType: typeof raw.agentType === 'string' ? raw.agentType : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      toolUseId: typeof raw.toolUseId === 'string' ? raw.toolUseId : undefined,
      spawnDepth: typeof raw.spawnDepth === 'number' ? raw.spawnDepth : undefined,
    }
  } catch {
    return {}
  }
}

export interface TranscriptFile extends TranscriptRef {
  sizeBytes: number
  mtimeMs: number
}

/** Recorre ~/.claude/projects y devuelve todos los transcripts encontrados. */
export async function scanTranscripts(): Promise<TranscriptFile[]> {
  let entries: string[] = []
  try {
    entries = (await readdir(PROJECTS_DIR, { recursive: true })) as string[]
  } catch {
    return []
  }
  const out: TranscriptFile[] = []
  for (const rel of entries) {
    if (!rel.endsWith('.jsonl')) continue
    const path = join(PROJECTS_DIR, rel)
    const ref = parseTranscriptPath(path)
    if (!ref) continue
    try {
      const s = await stat(path)
      out.push({ ...ref, sizeBytes: s.size, mtimeMs: s.mtimeMs })
    } catch {
      // desapareció entre el readdir y el stat
    }
  }
  return out
}

/** Transcripts de subagentes de una sesión. */
export async function scanSubagents(sessionId: string, slug: string): Promise<TranscriptRef[]> {
  const dir = join(PROJECTS_DIR, slug, sessionId, 'subagents')
  try {
    const files = await readdir(dir)
    return files
      .filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
      .map((f) => parseTranscriptPath(join(dir, f)))
      .filter((r): r is TranscriptRef => r !== null)
  } catch {
    return []
  }
}
