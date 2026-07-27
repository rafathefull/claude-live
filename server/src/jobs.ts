import { EventEmitter } from 'node:events'
import { readFile, readdir } from 'node:fs/promises'
import { watch } from 'node:fs'
import { join } from 'node:path'
import { DAEMON_ROSTER, JOBS_DIR } from './config.js'
import { isAlive } from './roster.js'
import type { JobInfo, JobState } from '../../shared/types.js'

/**
 * Jobs en segundo plano: `~/.claude/jobs/<id>/state.json`.
 *
 * Un job **vivo** ya se veía como sesión de background, porque el daemon lo publica en
 * `daemon/roster.json`. Lo que faltaba son los **terminados**, que no están en ningún roster:
 * son trabajo que encargaste y del que solo queda el resultado en disco.
 *
 * Mismo patrón que `roster.ts`: normalizador tolerante (esto es formato interno de Claude
 * Code), poll flojo más `fs.watch`, y huella para no repintar el mundo cada tres segundos.
 */

/** Tal cual lo escribe Claude Code, más `stale` que se deduce aquí. */
const KNOWN_STATES = new Set(['working', 'blocked', 'done', 'failed'])

interface RawState {
  [key: string]: unknown
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * `state.json` → `JobInfo`, o `null` si no hay nada aprovechable. Un campo que falte no es un
 * error: el fichero lo escribe otro programa y cambia de versión en versión.
 */
export function toJobInfo(id: string, raw: unknown, alive: boolean): JobInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as RawState
  const declared = text(o.state)
  if (!declared || !KNOWN_STATES.has(declared)) return null

  // Un job que se declara «trabajando» sin proceso detrás es un residuo: el daemon murió (o
  // reinició la máquina) y nadie actualizó el fichero. Decir que trabaja sería mentir.
  const running = declared === 'working' || declared === 'blocked'
  const state: JobState = running && !alive ? 'stale' : (declared as JobState)

  const output = o.output as { result?: unknown } | null | undefined
  return {
    id,
    name: text(o.name) ?? id,
    intent: text(o.intent),
    detail: text(o.detail),
    state,
    declaredState: declared as JobState,
    alive,
    cwd: text(o.cwd),
    sessionId: text(o.sessionId),
    createdAt: text(o.createdAt),
    updatedAt: text(o.updatedAt),
    result: text(output?.result),
    transcriptPath: text(o.linkScanPath),
  }
}

/** Ids de los workers que el daemon tiene de verdad en marcha. */
async function aliveWorkers(): Promise<Set<string>> {
  const live = new Set<string>()
  try {
    const roster = JSON.parse(await readFile(DAEMON_ROSTER, 'utf8')) as {
      workers?: Record<string, { pid?: number; procStart?: string; sessionId?: string }>
    }
    for (const [short, worker] of Object.entries(roster.workers ?? {})) {
      const pid = Number(worker?.pid)
      if (!Number.isFinite(pid)) continue
      if (!isAlive(pid, worker?.procStart)) continue
      live.add(short)
      if (worker?.sessionId) live.add(worker.sessionId)
    }
  } catch {
    // sin daemon, o roster ilegible: entonces no hay ningún job vivo, y punto
  }
  return live
}

export async function readJobs(): Promise<JobInfo[]> {
  let ids: string[]
  try {
    const entries = await readdir(JOBS_DIR, { withFileTypes: true })
    ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return [] // no has lanzado ningún job en background
  }

  const live = await aliveWorkers()
  const jobs: JobInfo[] = []
  for (const id of ids) {
    try {
      const raw = JSON.parse(await readFile(join(JOBS_DIR, id, 'state.json'), 'utf8'))
      const job = toJobInfo(id, raw, live.has(id))
      if (job) jobs.push(job)
    } catch {
      // un job a medio escribir o un directorio sin state.json: se ignora sin ruido
    }
  }

  // Lo que sigue en marcha primero, y el resto por lo último que hicieron.
  return jobs.sort(
    (a, b) =>
      Number(b.state === 'working' || b.state === 'blocked') -
        Number(a.state === 'working' || a.state === 'blocked') ||
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )
}

export class JobsWatcher extends EventEmitter {
  private timer?: NodeJS.Timeout
  private watcher?: ReturnType<typeof watch>
  private debounce?: NodeJS.Timeout
  private last = ''

  start(pollMs = 4000): void {
    void this.refresh()
    try {
      // Recursivo: lo que cambia es `<id>/state.json`, un nivel más abajo que en el roster.
      this.watcher = watch(JOBS_DIR, { recursive: true }, () => this.schedule())
      this.watcher.on('error', () => {})
    } catch {
      // el directorio puede no existir todavía; del resto se encarga el poll
    }
    this.timer = setInterval(() => void this.refresh(), pollMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    this.watcher?.close()
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.refresh(), 150)
  }

  private async refresh(): Promise<void> {
    const jobs = await readJobs()
    const fingerprint = JSON.stringify(
      jobs.map((job) => `${job.id}:${job.state}:${job.updatedAt ?? ''}:${job.detail ?? ''}`),
    )
    if (fingerprint === this.last) return
    this.last = fingerprint
    this.emit('change', jobs)
  }
}
