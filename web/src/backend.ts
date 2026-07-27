import type {
  ActorInfo,
  JobInfo,
  Metrics,
  ServerMessage,
  SessionInfo,
  TimelineEvent,
} from '@shared/types'
import type { Retention } from './store'

/**
 * De dónde salen los datos: del servidor local, o de un fichero estático.
 *
 * La versión que se publica en GitHub Pages no tiene servidor y **no puede leer tu `~/.claude`**:
 * viene con un mundo de demostración inventado dentro de un JSON. Todo lo demás —la escena, la
 * timeline, el reproductor, el vecindario, las métricas— es exactamente el mismo código, así que
 * lo que se ve ahí es lo que hace el visor de verdad.
 */

export const STATIC_MODE = import.meta.env.VITE_STATIC === '1'

export interface EventsPage {
  events: TimelineEvent[]
  total: number
}

export interface Backend {
  /** Abre el flujo de novedades. Devuelve una función para cerrarlo. */
  connect(handlers: {
    onMessage: (message: ServerMessage) => void
    onOpen: () => void
    onClose: () => void
  }): () => void
  sessionEvents(sessionId: string, from: number, limit: number): Promise<EventsPage>
  allSessions(): Promise<SessionInfo[]>
  retention(): Promise<Retention | null>
  metrics(force: boolean): Promise<Metrics | null>
  raw(sessionId: string, uuid: string): Promise<unknown>
}

/* ------------------------------------------------------------------ en vivo */

const live: Backend = {
  connect({ onMessage, onOpen, onClose }) {
    const source = new EventSource('/api/stream')
    source.onopen = onOpen
    source.onmessage = (message) => {
      try {
        onMessage(JSON.parse(message.data) as ServerMessage)
      } catch {
        // mensaje ilegible: se ignora
      }
    }
    source.onerror = () => {
      source.close()
      onClose()
    }
    return () => source.close()
  },

  async sessionEvents(sessionId, from, limit) {
    const response = await fetch(
      `/api/sessions/${sessionId}/events?from=${from}&limit=${limit}&agents=1`,
    )
    if (!response.ok) return { events: [], total: 0 }
    return (await response.json()) as EventsPage
  },

  async allSessions() {
    const response = await fetch('/api/sessions')
    if (!response.ok) return []
    return ((await response.json()) as { sessions: SessionInfo[] }).sessions
  },

  async retention() {
    const response = await fetch('/api/retention')
    if (!response.ok) return null
    return (await response.json()) as Retention
  },

  async metrics(force) {
    const response = await fetch(`/api/metrics${force ? '?force=1' : ''}`)
    if (!response.ok) return null
    return (await response.json()) as Metrics
  },

  async raw(sessionId, uuid) {
    const response = await fetch(`/api/sessions/${sessionId}/raw/${encodeURIComponent(uuid)}`)
    if (!response.ok) return null
    return response.json()
  },
}

/* ------------------------------------------------------------------ estático */

/** Lo que trae el fichero de demostración. Lo genera `tools/build-pages.ts`. */
export interface DemoWorld {
  sessions: SessionInfo[]
  agents: ActorInfo[]
  jobs: JobInfo[]
  events: Record<string, TimelineEvent[]>
  metrics: Metrics
  retention: Retention
  /** Sesión que hace de «en directo» y desde qué evento se empieza a emitir. */
  live: { sessionId: string; fromIndex: number }
}

const MIN_GAP_MS = 500
const MAX_GAP_MS = 2600
/** Pausa antes de volver a empezar el guion, para que se note el corte. */
const LOOP_PAUSE_MS = 6000

let world: Promise<DemoWorld> | null = null

function loadWorld(): Promise<DemoWorld> {
  world ??= fetch(`${import.meta.env.BASE_URL}data/demo.json`).then(
    (response) => response.json() as Promise<DemoWorld>,
  )
  return world
}

const staticBackend: Backend = {
  connect({ onMessage, onOpen }) {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    void loadWorld().then((demo) => {
      if (stopped) return
      onOpen()
      onMessage({
        type: 'hello',
        sessions: demo.sessions,
        agents: demo.agents,
        jobs: demo.jobs,
      })

      const script = demo.events[demo.live.sessionId] ?? []
      const from = Math.min(demo.live.fromIndex, script.length)

      // Lo anterior se suelta de golpe, como hace el servidor con su buffer reciente al
      // conectarse: así la página abre con el mundo ya poblado y no con un escenario vacío.
      for (const event of script.slice(0, from)) onMessage({ type: 'event', event })

      // El guion se repite en bucle: es una demostración y hay que poder mirarla dos veces. Cada
      // pasada lleva su propio sufijo en el uuid, porque el store deduplica por uuid y si no la
      // segunda vuelta se quedaría muda.
      let index = from
      let lap = 0

      const tick = (): void => {
        if (stopped) return
        const event = script[index]
        if (!event) {
          lap++
          index = from
          timer = setTimeout(tick, LOOP_PAUSE_MS)
          return
        }
        onMessage({
          type: 'event',
          event: lap === 0 ? event : { ...event, uuid: `${event.uuid}#${lap}` },
        })
        const next = script[index + 1]
        index++
        let gap = 900
        if (next) {
          const delta = Date.parse(next.ts) - Date.parse(event.ts)
          gap = Number.isFinite(delta) ? Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, delta)) : 900
        }
        timer = setTimeout(tick, gap)
      }

      timer = setTimeout(tick, 1200)
    })

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  },

  async sessionEvents(sessionId, from, limit) {
    const demo = await loadWorld()
    const all = demo.events[sessionId] ?? []
    return { events: all.slice(from, from + limit), total: all.length }
  },

  async allSessions() {
    return (await loadWorld()).sessions
  },

  async retention() {
    return (await loadWorld()).retention
  },

  async metrics() {
    return (await loadWorld()).metrics
  },

  async raw(sessionId, uuid) {
    const demo = await loadWorld()
    const event = (demo.events[sessionId] ?? []).find((candidate) => candidate.uuid === uuid)
    return event?.payload ?? { nota: 'En la demostración solo está el payload recortado.' }
  },
}

export const backend: Backend = STATIC_MODE ? staticBackend : live
