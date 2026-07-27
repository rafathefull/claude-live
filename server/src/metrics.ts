import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { CACHE_DIR, METRICS_CACHE } from './config.js'
import { readAgentMeta, scanTranscripts } from './discover.js'
import { forEachLine } from './lines.js'
import { TranscriptParser } from './parser.js'
import type { Metrics, MetricsBucket, TranscriptSummary } from '../../shared/types.js'

/**
 * Métricas agregadas por proyecto y por día, calculadas desde los transcripts.
 *
 * El índice del histórico no sirve para esto: solo lee la cabeza y la cola de cada fichero, así
 * que no sabe de tokens ni de herramientas. Aquí hay que recorrerlos enteros, y son casi cien
 * megas. Por eso se cachea el resumen **por fichero** con su mtime y su tamaño: un transcript
 * que no ha cambiado no se vuelve a leer, y los que crecen se releen enteros pero solo ellos.
 *
 * Todo lo que se agrega sale del parser, que ya normaliza tokens, herramienta y error: aquí no
 * se vuelve a interpretar el formato de Claude Code.
 */

interface CacheEntry {
  mtimeMs: number
  sizeBytes: number
  summary: TranscriptSummary
}

type Cache = Record<string, CacheEntry>

let cache: Cache | null = null

async function loadCache(): Promise<Cache> {
  if (cache) return cache
  try {
    cache = JSON.parse(await readFile(METRICS_CACHE, 'utf8')) as Cache
  } catch {
    cache = {}
  }
  return cache
}

async function saveCache(data: Cache): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(METRICS_CACHE, JSON.stringify(data), 'utf8')
  } catch {
    // sin caché se sigue funcionando, solo más lento
  }
}

/** `2026-07-27T21:14:03.123Z` → `2026-07-27`. Sin Date: el ISO ya viene en orden. */
export function dayOf(ts: string | undefined): string | null {
  if (!ts || ts.length < 10) return null
  const day = ts.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function emptyBucket(): MetricsBucket {
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

function add(target: MetricsBucket, source: MetricsBucket): void {
  target.sessions += source.sessions
  target.events += source.events
  target.toolCalls += source.toolCalls
  target.errors += source.errors
  target.prompts += source.prompts
  target.agents += source.agents
  target.tokensIn += source.tokensIn
  target.tokensOut += source.tokensOut
  target.tokensCache += source.tokensCache
  target.bytes += source.bytes
}

function bump(counts: Record<string, number>, key: string | undefined, by = 1): void {
  if (!key) return
  counts[key] = (counts[key] ?? 0) + by
}

/**
 * Recorre un transcript y lo resume. Los días salen del timestamp de cada evento, no del de la
 * sesión: una conversación de madrugada reparte su trabajo entre dos días, y contarla entera en
 * el primero falsearía la gráfica.
 */
export async function summarizeTranscript(
  path: string,
  sessionId: string,
  agentId: string | null,
  sizeBytes: number,
): Promise<TranscriptSummary> {
  const parser = new TranscriptParser({ sessionId, agentId })
  const days: Record<string, MetricsBucket> = {}
  const tools: Record<string, number> = {}
  const models: Record<string, number> = {}
  const agentTypes: Record<string, number> = {}
  let cwd: string | undefined
  let firstTs: string | undefined
  let lastTs: string | undefined

  await forEachLine(path, (line) => {
    // El cwd viaja en cada línea del transcript; con la primera que lo traiga vale.
    if (!cwd) {
      const match = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line)
      if (match?.[1]) cwd = match[1].replace(/\\(.)/g, '$1')
    }

    for (const event of parser.parse(line).events) {
      const day = dayOf(event.ts)
      if (!day) continue
      const bucket = (days[day] ??= emptyBucket())
      bucket.events++
      if (event.kind === 'tool_call' || event.kind === 'skill') {
        bucket.toolCalls++
        bump(tools, event.tool)
      }
      if (event.kind === 'prompt') bucket.prompts++
      if (event.isError) bucket.errors++
      if (event.tokens) {
        bucket.tokensIn += event.tokens.input
        bucket.tokensOut += event.tokens.output
        bucket.tokensCache += event.tokens.cacheRead + event.tokens.cacheCreate
      }
      if (event.model) bump(models, event.model)
      if (!firstTs || event.ts < firstTs) firstTs = event.ts
      if (!lastTs || event.ts > lastTs) lastTs = event.ts
    }
  })

  // El tamaño se atribuye al último día con actividad: es un dato del fichero, no del evento.
  const lastDay = lastTs ? dayOf(lastTs) : null
  if (lastDay && days[lastDay]) days[lastDay]!.bytes += sizeBytes

  const firstDay = firstTs ? dayOf(firstTs) : null
  if (firstDay && days[firstDay]) {
    if (agentId === null) {
      // Una sesión se cuenta una vez, en el día en que empezó, y solo si es el transcript
      // principal: los de subagentes son trabajo de la misma sesión, no sesiones aparte.
      days[firstDay]!.sessions += 1
    } else {
      // Un subagente no tiene evento de nacimiento en el transcript —eso lo sintetiza el
      // registro en vivo—, así que se cuenta por su propio fichero, y su tipo sale del
      // `.meta.json` de al lado, que es quien lo sabe.
      days[firstDay]!.agents += 1
      const meta = await readAgentMeta(path)
      bump(agentTypes, meta.agentType ?? 'sin-tipo')
    }
  }

  return { sessionId, agentId, cwd, days, tools, models, agentTypes, firstTs, lastTs }
}

/** Nombre de proyecto que se muestra: el último tramo del cwd. */
function projectOf(summary: TranscriptSummary): string {
  if (!summary.cwd) return '—'
  return summary.cwd.split('/').filter(Boolean).pop() ?? summary.cwd
}

export interface MetricsOptions {
  /** Recalcular todo, ignorando lo cacheado. */
  force?: boolean
}

export async function computeMetrics(opts: MetricsOptions = {}): Promise<Metrics> {
  const started = Date.now()
  const files = await scanTranscripts()
  const data = opts.force ? {} : await loadCache()
  const next: Cache = {}

  const byDay: Record<string, MetricsBucket> = {}
  const byProject: Record<string, MetricsBucket> = {}
  const projectDays: Record<string, Record<string, MetricsBucket>> = {}
  const tools: Record<string, number> = {}
  const models: Record<string, number> = {}
  const agentTypes: Record<string, number> = {}
  let reread = 0

  for (const file of files) {
    const cached = data[file.path]
    let summary: TranscriptSummary
    if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
      summary = cached.summary
    } else {
      summary = await summarizeTranscript(file.path, file.sessionId, file.agentId, file.sizeBytes)
      reread++
    }
    next[file.path] = { mtimeMs: file.mtimeMs, sizeBytes: file.sizeBytes, summary }

    const project = projectOf(summary)
    const projectBucket = (byProject[project] ??= emptyBucket())
    const perDay = (projectDays[project] ??= {})

    for (const [day, bucket] of Object.entries(summary.days)) {
      add((byDay[day] ??= emptyBucket()), bucket)
      add(projectBucket, bucket)
      add((perDay[day] ??= emptyBucket()), bucket)
    }
    for (const [tool, n] of Object.entries(summary.tools)) bump(tools, tool, n)
    for (const [model, n] of Object.entries(summary.models)) bump(models, model, n)
    for (const [type, n] of Object.entries(summary.agentTypes)) bump(agentTypes, type, n)
  }

  cache = next
  await saveCache(next)

  return {
    byDay,
    byProject,
    projectDays,
    tools,
    models,
    agentTypes,
    transcripts: files.length,
    reread,
    computedInMs: Date.now() - started,
  }
}
