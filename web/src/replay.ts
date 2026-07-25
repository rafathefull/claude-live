import { dispatch, state } from './store'

/**
 * Motor del reproductor. Vive fuera de la escena a propósito: así el replay sigue
 * avanzando en modo sobrio (sin canvas), y la escena solo tiene que escuchar eventos.
 *
 * El ritmo sale de los timestamps reales de la conversación, acotados para que ni las
 * ráfagas se atropellen ni los huecos de diez minutos congelen la reproducción.
 */

const MIN_GAP_MS = 45
const MAX_GAP_MS = 1400
const DEFAULT_GAP_MS = 320

let nextAt = 0
let lastSeekToken = -1
let running = false

function tick(now: number): void {
  const replay = state.replay
  const sessionId = replay.sessionId

  if (sessionId) {
    // Un salto (scrub, paso adelante/atrás) reinicia el reloj del reproductor.
    if (replay.seekToken !== lastSeekToken) {
      lastSeekToken = replay.seekToken
      nextAt = now
    }

    const events = state.events[sessionId] ?? []
    replay.total = events.length

    if (replay.playing && replay.index >= events.length) {
      replay.playing = false
    } else if (replay.playing && now >= nextAt) {
      const event = events[replay.index]
      replay.index++
      if (event) dispatch(event)

      const next = events[replay.index]
      let gap = DEFAULT_GAP_MS
      if (event && next) {
        const delta = Date.parse(next.ts) - Date.parse(event.ts)
        gap = Number.isFinite(delta) ? Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, delta)) : DEFAULT_GAP_MS
      }
      nextAt = now + gap / Math.max(0.25, replay.speed)
    }
  }

  requestAnimationFrame(tick)
}

export function startReplayEngine(): void {
  if (running) return
  running = true
  requestAnimationFrame(tick)
}
