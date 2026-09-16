import { ref, watch } from 'vue'
import { STATIC_MODE } from './backend'
import { lang } from './i18n'
import { idleNotice, idleTransitions, lastTextOf, noticeForEvent, shouldDisturb, type Notice } from './notify'
import { onEvent, state } from './store'

/**
 * Avisos del navegador cuando Claude te espera: el cableado con la API `Notification`, el
 * permiso y la preferencia recordada. La decisión de qué avisar vive en `notify.ts`.
 *
 * Es opcional y empieza apagado: hay que pulsar la campana y aceptar el permiso del navegador.
 * En la demostración publicada no tiene sentido y no se ofrece.
 */

const STORAGE_KEY = 'claude-live:notify'
/** Antes de avisar de un fin de turno se espera un poco: Claude Code pasa por «idle» entre pasos. */
const IDLE_SETTLE_MS = 4000

export const notifySupported =
  typeof window !== 'undefined' && typeof Notification !== 'undefined' && !STATIC_MODE

function stored(): boolean {
  try {
    return (
      notifySupported &&
      localStorage.getItem(STORAGE_KEY) === '1' &&
      Notification.permission === 'granted'
    )
  } catch {
    return false
  }
}

export const notifyEnabled = ref(stored())

export async function toggleNotify(): Promise<void> {
  if (notifyEnabled.value) {
    notifyEnabled.value = false
    try {
      localStorage.setItem(STORAGE_KEY, '0')
    } catch {
      // sin almacenamiento, no se recuerda y ya
    }
    return
  }
  if (!notifySupported) return
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return
  notifyEnabled.value = true
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // ídem
  }
}

function show(notice: Notice): void {
  if (!notifyEnabled.value) return
  if (!shouldDisturb({ hidden: document.hidden, focused: document.hasFocus() })) return
  const notification = new Notification(notice.title[lang.value], {
    body: notice.body,
    tag: notice.tag,
  })
  notification.onclick = () => {
    window.focus()
    state.selectedSessionId = notice.sessionId
    notification.close()
  }
}

/** Engancha los avisos al store. Devuelve la función que los desengancha. */
export function startNotifications(): () => void {
  if (!notifySupported) return () => {}

  // Un permiso, una pregunta o un plan: se avisa en el momento.
  const stopEvents = onEvent((event) => {
    if (!notifyEnabled.value) return
    const session = state.sessions.find((candidate) => candidate.sessionId === event.sessionId)
    if (!session?.live) return
    const notice = noticeForEvent(event, session.project)
    if (notice) show(notice)
  })

  // El fin de turno se deduce del roster: la sesión pasa de trabajar a esperarte. Se deja
  // asentar unos segundos y se comprueba que sigue esperando antes de avisar.
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const stopSessions = watch(
    () => state.sessions,
    (next, prev) => {
      if (!notifyEnabled.value) return
      for (const session of idleTransitions(prev ?? [], next)) {
        const existing = pending.get(session.sessionId)
        if (existing) clearTimeout(existing)
        pending.set(
          session.sessionId,
          setTimeout(() => {
            pending.delete(session.sessionId)
            const now = state.sessions.find((candidate) => candidate.sessionId === session.sessionId)
            if (!now?.live || now.status !== 'idle') return
            show(idleNotice(now, lastTextOf(state.events[session.sessionId] ?? [])))
          }, IDLE_SETTLE_MS),
        )
      }
    },
  )

  return () => {
    stopEvents()
    stopSessions()
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
  }
}
