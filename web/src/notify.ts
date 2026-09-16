import type { Text } from '@shared/i18n'
import type { SessionInfo, TimelineEvent } from '@shared/types'

/**
 * Cuándo merece la pena avisarte: la parte pura, sin navegador, para poder probarla en Node.
 *
 * El dato que lo justifica: en las métricas de este repositorio, el 61 % del tiempo activo es
 * Claude esperando tu siguiente mensaje, y otro 3 % son preguntas sin responder. Casi siempre es
 * porque no estabas mirando. El aviso ataca justo eso, y sin tocar nada de Claude: solo lee lo que
 * ya llega al visor.
 */

export interface Notice {
  sessionId: string
  title: Text
  /** Lo que dijo Claude o lo que pide, ya recortado. */
  body: string
  /** Un aviso nuevo de la misma sesión y del mismo tipo sustituye al anterior. */
  tag: string
}

/** Herramientas con las que Claude te pasa la palabra. */
const HANDOFF_TOOLS: Record<string, Text> = {
  AskUserQuestion: { es: 'Claude te pregunta', en: 'Claude has a question for you' },
  ExitPlanMode: { es: 'Claude tiene un plan para aprobar', en: 'Claude has a plan for you to approve' },
}

const MAX_BODY = 140

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY - 1)}…` : flat
}

/** Un evento que pide algo de ti: un permiso, una pregunta, un plan. Si no, null. */
export function noticeForEvent(event: TimelineEvent, project: string): Notice | null {
  if (event.kind === 'permission') {
    return {
      sessionId: event.sessionId,
      title: { es: `${project} · Claude pide permiso`, en: `${project} · Claude asks for permission` },
      body: clip(event.summary.replace(/^esperando permiso:\s*/i, '')),
      tag: `${event.sessionId}:permission`,
    }
  }
  if (event.kind === 'tool_call' && event.tool && HANDOFF_TOOLS[event.tool]) {
    const what = HANDOFF_TOOLS[event.tool]!
    return {
      sessionId: event.sessionId,
      title: { es: `${project} · ${what.es}`, en: `${project} · ${what.en}` },
      body: clip(event.summary),
      tag: `${event.sessionId}:ask`,
    }
  }
  return null
}

/** Sesiones vivas que acaban de pasar de trabajar a esperarte. */
export function idleTransitions(
  prev: readonly Pick<SessionInfo, 'sessionId' | 'status'>[],
  next: readonly SessionInfo[],
): SessionInfo[] {
  const before = new Map(prev.map((session) => [session.sessionId, session.status]))
  return next.filter(
    (session) => session.live && session.status === 'idle' && before.get(session.sessionId) === 'busy',
  )
}

/** El aviso de fin de turno: qué fue lo último que dijo Claude, para que sepas a qué vuelves. */
export function idleNotice(session: SessionInfo, lastSaid: string | undefined): Notice {
  return {
    sessionId: session.sessionId,
    title: { es: `${session.project} · Claude te espera`, en: `${session.project} · Claude is waiting for you` },
    body: clip(lastSaid ?? ''),
    tag: `${session.sessionId}:idle`,
  }
}

/** Solo se molesta a quien no está mirando: pestaña oculta o ventana sin foco. */
export function shouldDisturb(view: { hidden: boolean; focused: boolean }): boolean {
  return view.hidden || !view.focused
}

/** Lo último que Claude dijo en una sesión, para el cuerpo del aviso. */
export function lastTextOf(events: readonly TimelineEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind === 'text' && event.agentId === null) return event.summary
  }
  return undefined
}
