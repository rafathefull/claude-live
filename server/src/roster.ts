import { EventEmitter } from 'node:events'
import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { watch } from 'node:fs'
import { basename, join } from 'node:path'
import { DAEMON_ROSTER, PROJECTS_DIR, SESSIONS_DIR } from './config.js'
import type { SessionStatus } from '../../shared/types.js'

/**
 * Descubrimiento de sesiones vivas. No hace falta arrancar nada en el directorio a
 * controlar: Claude Code publica un fichero por proceso en ~/.claude/sessions/<pid>.json
 * y los workers de background en ~/.claude/daemon/roster.json. Aquí solo se leen.
 */

export interface RosterEntry {
  pid: number
  sessionId: string
  cwd: string
  startedAt?: number
  updatedAt?: number
  /** Campo 22 de /proc/<pid>/stat cuando arrancó el proceso: detecta PIDs reciclados. */
  procStart?: string
  version?: string
  kind?: string
  entrypoint?: string
  name?: string
  status?: SessionStatus
  background: boolean
}

/**
 * starttime (campo 22) de /proc/<pid>/stat. El campo 2 (comm) va entre paréntesis y
 * puede contener espacios, así que se corta a partir del último ')'.
 */
function procStartOf(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    if (close === -1) return null
    const fields = stat.slice(close + 2).trim().split(/\s+/)
    // fields[0] es el campo 3 (state) → starttime (campo 22) es fields[19].
    return fields[19] ?? null
  } catch {
    return null
  }
}

/**
 * El proceso sigue vivo Y es el mismo que escribió el fichero (no un PID reciclado).
 *
 * En Linux se compara el starttime de /proc, que descarta PIDs reciclados. Donde no hay
 * /proc (macOS) se cae a una señal 0, que solo confirma que el PID existe.
 */
export function isAlive(pid: number, procStart?: string): boolean {
  const current = procStartOf(pid)
  if (current !== null) return !procStart || current === procStart
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function toEntry(raw: unknown, background: boolean): RosterEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const pid = typeof o.pid === 'number' ? o.pid : Number(o.pid)
  const sessionId = typeof o.sessionId === 'string' ? o.sessionId : null
  const cwd = typeof o.cwd === 'string' ? o.cwd : null
  if (!Number.isFinite(pid) || !sessionId || !cwd) return null
  const status = o.status
  return {
    pid,
    sessionId,
    cwd,
    startedAt: typeof o.startedAt === 'number' ? o.startedAt : undefined,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : undefined,
    procStart: typeof o.procStart === 'string' ? o.procStart : undefined,
    version:
      typeof o.version === 'string'
        ? o.version
        : typeof o.cliVersion === 'string'
          ? o.cliVersion
          : undefined,
    kind: typeof o.kind === 'string' ? o.kind : undefined,
    entrypoint: typeof o.entrypoint === 'string' ? o.entrypoint : undefined,
    name: typeof o.name === 'string' ? o.name : undefined,
    status:
      status === 'busy' || status === 'idle' || status === 'dead' ? status : 'unknown',
    background,
  }
}

/** Lee el roster completo (interactivas + background) descartando entradas muertas. */
export async function readRoster(): Promise<RosterEntry[]> {
  const out: RosterEntry[] = []
  const seen = new Set<string>()

  let files: string[] = []
  try {
    files = await readdir(SESSIONS_DIR)
  } catch {
    files = []
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const entry = toEntry(JSON.parse(await readFile(join(SESSIONS_DIR, f), 'utf8')), false)
      if (!entry) continue
      if (!isAlive(entry.pid, entry.procStart)) continue
      if (seen.has(entry.sessionId)) continue
      seen.add(entry.sessionId)
      out.push(entry)
    } catch {
      // fichero a medio escribir o corrupto: se ignora, el próximo ciclo lo recoge
    }
  }

  try {
    const roster = JSON.parse(await readFile(DAEMON_ROSTER, 'utf8')) as {
      workers?: Record<string, unknown>
    }
    for (const worker of Object.values(roster.workers ?? {})) {
      const entry = toEntry(worker, true)
      if (!entry) continue
      if (!isAlive(entry.pid, entry.procStart)) continue
      if (seen.has(entry.sessionId)) continue
      seen.add(entry.sessionId)
      out.push(entry)
    }
  } catch {
    // sin daemon o roster ilegible: no es un error
  }

  return out
}

/**
 * `/home/rafa/IdeaProjects/source/backend` → `-home-rafa-IdeaProjects-source-backend`.
 * Cualquier carácter no alfanumérico pasa a `-` (comprobado con un directorio real:
 * `Diseño en pantalla` → `Dise-o-en-pantalla`).
 *
 * Es solo una pista: el emparejamiento real sesión ↔ fichero lo hace el índice del
 * watcher por `sessionId`, así que un slug que no acierte no rompe nada.
 */
export function slugForCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function transcriptPathFor(entry: RosterEntry): string {
  return join(PROJECTS_DIR, slugForCwd(entry.cwd), `${entry.sessionId}.jsonl`)
}

export function projectNameOf(cwd: string): string {
  return basename(cwd) || cwd
}

/**
 * Vigila el roster y emite `change` con la lista actualizada. fs.watch cubre la
 * aparición/desaparición de ficheros y los cambios de `status`; el poll de respaldo
 * cubre las muertes bruscas (kill -9 no borra el fichero, pero el PID deja de existir).
 */
export class RosterWatcher extends EventEmitter {
  private timer?: NodeJS.Timeout
  private watcher?: ReturnType<typeof watch>
  private debounce?: NodeJS.Timeout
  private last = ''

  start(pollMs = 3000): void {
    void this.refresh()
    try {
      this.watcher = watch(SESSIONS_DIR, () => this.schedule())
      this.watcher.on('error', () => {})
    } catch {
      // el directorio puede no existir todavía; el poll se encarga
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
    this.debounce = setTimeout(() => void this.refresh(), 120)
  }

  private async refresh(): Promise<void> {
    const entries = await readRoster()
    // Solo se notifica si algo cambió de verdad: evita repintar el mundo cada 3 s.
    const fingerprint = JSON.stringify(
      entries
        .map((e) => `${e.sessionId}:${e.pid}:${e.status}:${e.updatedAt ?? 0}`)
        .sort(),
    )
    if (fingerprint === this.last) return
    this.last = fingerprint
    this.emit('change', entries)
  }
}
