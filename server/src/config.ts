import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOME = homedir()
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(HOME, '.claude')

/** Un subdirectorio por cwd; dentro, un <sessionId>.jsonl por sesión. */
export const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')
/** Un <pid>.json por proceso `claude` vivo. */
export const SESSIONS_DIR = join(CLAUDE_DIR, 'sessions')
/** Sesiones lanzadas en background por el daemon. */
export const DAEMON_ROSTER = join(CLAUDE_DIR, 'daemon', 'roster.json')
/** Jobs en background. */
export const JOBS_DIR = join(CLAUDE_DIR, 'jobs')

export const PORT = Number(process.env.CLAUDE_LIVE_PORT ?? 7317)
/** Solo loopback: los transcripts contienen código y prompts. */
export const HOST = '127.0.0.1'

/** Hay líneas de más de 700 KB en transcripts reales: se recorta para el stream. */
export const MAX_PAYLOAD_BYTES = 8 * 1024
/** Longitud máxima de un resumen de una línea. */
export const MAX_SUMMARY_CHARS = 180
/** Cuántos eventos recientes se reenvían al conectar, por sesión viva. */
export const BACKFILL_LINES = 150
/** Ventana de cola de fichero que se lee para el backfill y el tail. */
export const TAIL_BYTES = 512 * 1024

export const CACHE_DIR = join(
  process.env.XDG_DATA_HOME ?? join(HOME, '.local', 'share'),
  'claude-live',
)
/**
 * El índice se guarda por directorio de configuración: con un `CLAUDE_CONFIG_DIR` distinto
 * (la demostración, un mundo sembrado para las pruebas) las entradas de uno apuntaban a
 * ficheros del otro, y al abrir una sesión se leía una ruta que ya no existía.
 */
export const INDEX_CACHE = join(
  CACHE_DIR,
  process.env.CLAUDE_CONFIG_DIR ? `index-${slugify(CLAUDE_DIR)}.json` : 'index.json',
)

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+|-+$/g, '').slice(-60)
}

export const WEB_DIST = new URL('../../web-dist/', import.meta.url)
