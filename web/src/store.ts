import { computed, reactive, ref } from 'vue'
import type { ActorInfo, ServerMessage, SessionInfo, TimelineEvent } from '@shared/types'

/**
 * Estado del mundo en el front. Un único store reactivo alimentado por SSE; la escena de
 * Pixi lo lee pero nunca se re-renderiza por reactividad de Vue (se suscribe a `onEvent`).
 */

/** Tope del buffer de una sesión en vivo (el histórico se carga completo para el replay). */
const MAX_EVENTS_PER_SESSION = 800
/**
 * Tamaño de página del historial. El servidor tiene su propio techo de 2000 por petición, así
 * que las conversaciones largas se traen por tramos: el reproductor pide el siguiente cuando
 * se acerca al final de lo cargado, en lugar de quedarse mudo a mitad de la película.
 */
const HISTORY_PAGE = 1000
/** Cuántos eventos por delante hacen falta para no pedir la página siguiente. */
const PREFETCH_MARGIN = 250

export interface AgentView extends ActorInfo {
  active: boolean
  /** Última estación visitada, para pintarlo en el sitio correcto. */
  lastStation?: string
  events: number
}

/** Reproductor de una sesión: recorre sus eventos como una película. */
export interface ReplayState {
  sessionId: string | null
  /** Cuántos eventos se han representado ya. */
  index: number
  total: number
  playing: boolean
  /** Multiplicador de velocidad (1, 2, 4, 8, 16). */
  speed: number
  /** Marca de que hay que reconstruir el mundo desde `index` (tras un salto). */
  seekToken: number
  /** Eventos que la sesión tiene y todavía no se han traído del servidor. */
  pending: number
}

interface State {
  connected: boolean
  sessions: SessionInfo[]
  selectedSessionId: string | null
  agents: Record<string, AgentView>
  events: Record<string, TimelineEvent[]>
  showThinking: boolean
  soberMode: boolean
  /** Filtro de la timeline: id de actor ('main' o agentId) o null para todo. */
  focusActor: string | null
  selectedEvent: TimelineEvent | null
  /** Sesión que se está trayendo del histórico, para poder avisar mientras tarda. */
  loadingSession: string | null
  replay: ReplayState
}

export const state = reactive<State>({
  connected: false,
  sessions: [],
  selectedSessionId: null,
  agents: {},
  events: {},
  showThinking: true,
  soberMode: false,
  focusActor: null,
  selectedEvent: null,
  loadingSession: null,
  replay: {
    sessionId: null,
    index: 0,
    total: 0,
    playing: false,
    speed: 4,
    seekToken: 0,
    pending: 0,
  },
})

type EventListener = (event: TimelineEvent) => void
const listeners = new Set<EventListener>()

/** La escena se suscribe aquí para animar sin depender del ciclo de render de Vue. */
export function onEvent(listener: EventListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Empuja un evento a los suscriptores sin añadirlo al buffer. Lo usa el reproductor:
 * los eventos ya están cargados, solo hay que representarlos a su ritmo.
 */
export function dispatch(event: TimelineEvent): void {
  for (const listener of listeners) listener(event)
}

export const selectedSession = computed(
  () => state.sessions.find((s) => s.sessionId === state.selectedSessionId) ?? null,
)

export const liveSessions = computed(() => state.sessions.filter((s) => s.live))

/** ¿La sesión seleccionada se está reproduciendo (histórico) en lugar de emitir en vivo? */
export const isReplaying = computed(
  () => state.replay.sessionId !== null && state.replay.sessionId === state.selectedSessionId,
)

/** Todos los eventos cargados de la sesión seleccionada, sin filtros ni corte de replay. */
export const allEvents = computed(() =>
  state.selectedSessionId ? (state.events[state.selectedSessionId] ?? []) : [],
)

export const currentEvents = computed(() => {
  const id = state.selectedSessionId
  if (!id) return []
  const full = state.events[id] ?? []
  // En replay la timeline solo muestra lo ya reproducido, para que acompañe al mundo.
  const list = isReplaying.value ? full.slice(0, state.replay.index) : full
  return list.filter((event) => {
    if (!state.showThinking && event.kind === 'thinking') return false
    if (state.focusActor === null) return true
    if (state.focusActor === 'main') return event.agentId === null
    return event.agentId === state.focusActor
  })
})

export const currentAgents = computed(() =>
  Object.values(state.agents).filter((a) => a.sessionId === state.selectedSessionId),
)

function ensureSelection(): void {
  if (state.selectedSessionId && state.sessions.some((s) => s.sessionId === state.selectedSessionId)) {
    return
  }
  const live = state.sessions.find((s) => s.live)
  state.selectedSessionId = (live ?? state.sessions[0])?.sessionId ?? null
}

/** uuids ya recibidos por sesión, para no repetir eventos tras una reconexión. */
const seen = new Map<string, Set<string>>()

function addEvent(event: TimelineEvent): void {
  const list = (state.events[event.sessionId] ??= [])
  const known = seen.get(event.sessionId) ?? new Set<string>()
  if (!seen.has(event.sessionId)) seen.set(event.sessionId, known)

  // Al reconectar, el servidor reenvía su buffer reciente. El uuid es la única clave que
  // tienen todos los eventos: los de pensamiento y texto no llevan toolUseId, así que sin
  // esto aparecían por duplicado cada vez que se caía el SSE.
  if (known.has(event.uuid)) {
    const twin = list.find((e) => e.uuid === event.uuid)
    if (twin) Object.assign(twin, event)
    return
  }

  // Dedupe entre fuentes: los hooks HTTP llegan antes que el transcript y describen la
  // misma llamada, pero con otro uuid.
  if (event.toolUseId) {
    const twin = list.find((e) => e.toolUseId === event.toolUseId && e.kind === event.kind)
    if (twin) {
      known.add(event.uuid)
      Object.assign(twin, { ...event, uuid: twin.uuid })
      return
    }
  }

  list.push(event)
  known.add(event.uuid)
  if (list.length > MAX_EVENTS_PER_SESSION) {
    for (const dropped of list.splice(0, list.length - MAX_EVENTS_PER_SESSION)) {
      known.delete(dropped.uuid)
    }
  }

  if (event.agentId) {
    const agent = state.agents[event.agentId]
    if (agent) {
      agent.events++
      if (event.station) agent.lastStation = event.station
    }
  }

  for (const listener of listeners) listener(event)
}

function upsertAgent(agent: ActorInfo, active: boolean): void {
  const existing = state.agents[agent.id]
  if (existing) {
    Object.assign(existing, agent, { active })
    return
  }
  state.agents[agent.id] = { ...agent, active, events: 0 }
}

/** Aplica un mensaje del servidor al estado. Exportada para poder probarla sin navegador. */
export function applyServerMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'hello':
      state.sessions = message.sessions
      for (const agent of message.agents) upsertAgent(agent, agent.done !== true)
      ensureSelection()
      break
    case 'sessions':
      state.sessions = message.sessions
      ensureSelection()
      break
    case 'event':
      addEvent(message.event)
      break
    case 'agent':
      // El sessionId viaja dentro del actor: deducirlo de la sesión seleccionada metía los
      // subagentes en la habitación equivocada cuando había dos sesiones abiertas.
      upsertAgent(message.agent, message.state === 'spawn')
      break
  }
}

export const reconnectAttempts = ref(0)

export function connect(): void {
  const source = new EventSource('/api/stream')

  source.onopen = () => {
    state.connected = true
    reconnectAttempts.value = 0
  }

  source.onmessage = (message) => {
    try {
      applyServerMessage(JSON.parse(message.data) as ServerMessage)
    } catch {
      // mensaje ilegible: se ignora
    }
  }

  source.onerror = () => {
    state.connected = false
    source.close()
    reconnectAttempts.value++
    const delay = Math.min(1000 * reconnectAttempts.value, 10_000)
    setTimeout(connect, delay)
  }
}

/**
 * Carga los eventos de una sesión completa (para el historial y el replay).
 * A diferencia del stream en vivo, aquí NO se recorta a los últimos N: el reproductor
 * necesita la conversación entera desde el principio.
 */
export async function loadSessionEvents(sessionId: string, limit = HISTORY_PAGE): Promise<number> {
  const response = await fetch(`/api/sessions/${sessionId}/events?limit=${limit}&agents=1`)
  if (!response.ok) return 0
  const data = (await response.json()) as { events: TimelineEvent[]; total: number }
  state.events[sessionId] = data.events
  loadedTotals[sessionId] = data.total

  // El índice del historial solo lee la cabeza y la cola del fichero, así que no sabe de
  // tokens: se suman aquí para que el HUD no muestre un 0 en las sesiones ya cerradas.
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }
  for (const event of data.events) {
    if (event.agentId && event.actor) upsertAgent(event.actor, false)
    if (!event.tokens) continue
    totals.input += event.tokens.input
    totals.output += event.tokens.output
    totals.cacheRead += event.tokens.cacheRead
    totals.cacheCreate += event.tokens.cacheCreate
  }
  const session = state.sessions.find((s) => s.sessionId === sessionId)
  if (session && !session.live) session.tokens = totals

  return data.events.length
}

// ---------------------------------------------------------------- reproductor

export const SPEEDS = [0.5, 1, 2, 4, 8, 16]

/** Cuántos eventos tiene de verdad cada sesión del historial, según el servidor. */
const loadedTotals: Record<string, number> = {}
/** Peticiones de página en vuelo, para no pedir el mismo tramo dos veces. */
const fetching = new Set<string>()

/**
 * Trae el siguiente tramo si el reproductor se está acercando al final de lo cargado. La
 * llama el motor del reproductor en cada avance; es idempotente y no bloquea.
 */
export function ensureUpcomingEvents(sessionId: string): void {
  const loaded = state.events[sessionId]?.length ?? 0
  const total = loadedTotals[sessionId] ?? loaded
  if (loaded >= total || fetching.has(sessionId)) return
  if (state.replay.index + PREFETCH_MARGIN < loaded) return

  fetching.add(sessionId)
  void fetch(`/api/sessions/${sessionId}/events?from=${loaded}&limit=${HISTORY_PAGE}&agents=1`)
    .then(async (response) => {
      if (!response.ok) return
      const data = (await response.json()) as { events: TimelineEvent[]; total: number }
      loadedTotals[sessionId] = data.total
      const list = state.events[sessionId]
      if (!list) return
      if (data.events.length === 0) {
        state.replay.pending = 0
        return
      }
      list.push(...data.events)
      for (const event of data.events) {
        if (event.agentId && event.actor) upsertAgent(event.actor, false)
      }
      state.replay.total = list.length
      state.replay.pending = Math.max(0, data.total - list.length)
    })
    .catch(() => {
      // sin red o sesión desaparecida: el reproductor sigue con lo que tenga
    })
    .finally(() => fetching.delete(sessionId))
}

/** Cuántos eventos tiene la sesión en total, contando lo que aún no se ha traído. */
export function totalEventsOf(sessionId: string): number {
  return loadedTotals[sessionId] ?? state.events[sessionId]?.length ?? 0
}

/** Empieza a reproducir una sesión desde el principio. */
export function startReplay(sessionId: string, total: number, play = true): void {
  state.replay.sessionId = sessionId
  state.replay.index = 0
  state.replay.total = total
  state.replay.pending = Math.max(0, totalEventsOf(sessionId) - total)
  state.replay.playing = play
  state.replay.seekToken++
}

/**
 * Vuelve a abrir el reproductor de una sesión del historial. La ✕ de la barra lo cierra, así
 * que hace falta un camino de vuelta; si los eventos ya están cargados no se vuelven a pedir.
 */
export async function resumeReplay(sessionId: string): Promise<void> {
  const loaded = state.events[sessionId]?.length ?? 0
  const total = loaded > 0 ? loaded : await loadSessionEvents(sessionId)
  if (total === 0) return
  startReplay(sessionId, total)
}

export function stopReplay(): void {
  state.replay.sessionId = null
  state.replay.playing = false
  state.replay.index = 0
  state.replay.total = 0
  state.replay.pending = 0
}

export function togglePlay(): void {
  if (!state.replay.sessionId) return
  // Al darle a play habiendo terminado, se vuelve a empezar.
  if (!state.replay.playing && state.replay.index >= state.replay.total) {
    seekTo(0)
  }
  state.replay.playing = !state.replay.playing
}

export function setSpeed(speed: number): void {
  state.replay.speed = speed
}

/** Salta a una posición absoluta: el mundo se reconstruye desde ahí. */
export function seekTo(index: number): void {
  // Se acota al total real (lo cargado más lo que queda por traer): saltar al final debe
  // llevar al final de la conversación, no al de la primera página.
  const reachable = state.replay.total + state.replay.pending
  const clamped = Math.max(0, Math.min(index, reachable))
  state.replay.index = clamped
  state.replay.seekToken++
  if (state.replay.sessionId) ensureUpcomingEvents(state.replay.sessionId)
}

export function step(delta: number): void {
  state.replay.playing = false
  seekTo(state.replay.index + delta)
}

/** Cuánta historia sobrevive a la limpieza de Claude Code. */
export interface Retention {
  onDisk: number
  known: number
  missing: number
  cleanupPeriodDays: number
  configured: boolean
  oldest?: string
}

export async function loadRetention(): Promise<Retention | null> {
  try {
    const response = await fetch('/api/retention')
    return response.ok ? ((await response.json()) as Retention) : null
  } catch {
    return null
  }
}

export async function loadAllSessions(): Promise<SessionInfo[]> {
  const response = await fetch('/api/sessions')
  if (!response.ok) return []
  const data = (await response.json()) as { sessions: SessionInfo[] }
  return data.sessions
}

export async function loadRaw(sessionId: string, uuid: string): Promise<unknown> {
  const response = await fetch(`/api/sessions/${sessionId}/raw/${encodeURIComponent(uuid)}`)
  if (!response.ok) return null
  return response.json()
}
