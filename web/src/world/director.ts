import type { EventKind, StationId, TimelineEvent } from '@shared/types'
import type { Scene } from './Scene'
import type { ActorMood } from './Actor'
import { shouldMerge } from './grouping'

/**
 * El reloj del mundo.
 *
 * Los eventos llegan a ráfagas (10 llamadas a herramientas en 2 s), pero una escena solo
 * es legible si cada acción dura un mínimo. El director encola por actor y comprime de
 * forma adaptativa: cuanto más larga la cola, más rápido camina el actor y menos tiempo
 * se sostiene cada acción. Las llamadas repetidas a la misma estación se agrupan
 * («Read ×7»). Nunca se descarta un evento: la timeline sigue mostrándolos todos.
 */

const HOLD_BASE_MS = 420
const HOLD_MIN_MS = 90
const USER_ID = 'user'
const MAIN_ID = 'main'

interface Action {
  kind: EventKind
  station?: StationId
  tool?: string
  label?: string
  count: number
  run: (repeats: number) => void
}

/**
 * Nombre del avatar de un subagente: su tipo y, si tiene hermanos del mismo tipo, el número
 * que lo distingue («Explore 2»). Coincide con la etiqueta de la timeline.
 */
function agentLabel(info: TimelineEvent['actor']): string {
  if (!info?.agentType) return 'agente'
  return info.variant ? `${info.agentType} ${info.variant + 1}` : info.agentType
}

export class Director {
  private queues = new Map<string, Action[]>()
  private busyUntil = new Map<string, number>()
  /** agentType → ids de sus avatares, para numerarlos solo cuando hay más de uno. */
  private agentsByType = new Map<string, string[]>()

  constructor(private scene: Scene) {}

  /** Crea los habitantes fijos: tú y Claude. */
  bootstrap(sessionLabel: string): void {
    const user = this.scene.ensureActor({
      id: USER_ID,
      emoji: '🧑',
      color: 0xfacc15,
      label: 'tú',
      at: 'desk',
    })
    user.place(...this.deskSpot(0.5, 0.9))

    const main = this.scene.ensureActor({
      id: MAIN_ID,
      emoji: '🤖',
      color: 0xe5e7eb,
      label: sessionLabel,
      radius: 28,
      at: 'desk',
    })
    main.place(...this.deskSpot(0.5, 0.62))
  }

  setMainLabel(label: string): void {
    this.scene.actor(MAIN_ID)?.setLabel(label)
  }

  /** Vacía el mundo (cambio de sesión). */
  reset(sessionLabel: string): void {
    for (const id of [...this.queues.keys()]) this.queues.delete(id)
    this.busyUntil.clear()
    this.agentsByType.clear()
    for (const actorId of this.knownActors()) {
      if (actorId !== USER_ID && actorId !== MAIN_ID) this.scene.removeActor(actorId)
    }
    this.setMainLabel(sessionLabel)
  }

  private knownActors(): string[] {
    return [...this.queues.keys()]
  }

  private deskSpot(x: number, y: number): [number, number] {
    const width = this.scene.app.screen.width
    const height = this.scene.app.screen.height
    return [x * width, y * height]
  }

  private actorIdFor(event: TimelineEvent): string {
    if (event.kind === 'prompt') return USER_ID
    return event.agentId ?? MAIN_ID
  }

  /** Traduce un evento a una acción y la encola en la cola de su actor. */
  handle(event: TimelineEvent): void {
    const actorId = this.actorIdFor(event)
    this.ensureActorFor(event, actorId)
    const queue = this.queues.get(actorId) ?? []
    if (!this.queues.has(actorId)) this.queues.set(actorId, queue)

    const action = this.actionFor(event, actorId)
    if (!action) return

    if (shouldMerge(queue[queue.length - 1], action, queue.length)) {
      queue[queue.length - 1].count++
      return
    }
    queue.push(action)
  }

  /**
   * Lleva la cuenta de los avatares por tipo. Mientras hay uno solo se llama «Explore»; en
   * cuanto nace un hermano, todos pasan a numerarse para poder seguirlos por separado.
   */
  private registerAgentActor(actorId: string, info: TimelineEvent['actor']): void {
    const type = info?.agentType
    if (!type) return
    const siblings = this.agentsByType.get(type) ?? []
    if (!this.agentsByType.has(type)) this.agentsByType.set(type, siblings)
    if (!siblings.includes(actorId)) siblings.push(actorId)
    if (siblings.length < 2) return
    for (const [index, id] of siblings.entries()) {
      this.scene.actor(id)?.setLabel(`${type} ${index + 1}`)
    }
  }

  private ensureActorFor(event: TimelineEvent, actorId: string): void {
    if (actorId === USER_ID || actorId === MAIN_ID) return
    const info = event.actor
    this.scene.ensureActor({
      id: actorId,
      emoji: '👤',
      color: this.scene.colorForAgent(info?.agentType, info?.variant),
      label: agentLabel(info),
      subLabel: info?.description,
      radius: 20,
      nearActorId: MAIN_ID,
    })
    this.registerAgentActor(actorId, info)
  }

  private actionFor(event: TimelineEvent, actorId: string): Action | null {
    const scene = this.scene
    const mood = (m: ActorMood) => scene.actor(actorId)?.setMood(m)

    switch (event.kind) {
      case 'prompt':
        return {
          kind: event.kind,
          count: 1,
          run: () => {
            scene.actor(USER_ID)?.say(event.summary, 6000)
            scene.drawLink(USER_ID, MAIN_ID, 0xfacc15, 1200)
            scene.actor(MAIN_ID)?.setMood('thinking')
          },
        }
      case 'thinking':
        return {
          kind: event.kind,
          count: 1,
          run: () => {
            mood('thinking')
            scene.actor(actorId)?.say(`💭 ${event.summary}`, 5000)
          },
        }
      case 'text':
        return {
          kind: event.kind,
          count: 1,
          run: () => {
            mood('talking')
            scene.actor(actorId)?.say(event.summary, 5000)
          },
        }
      case 'skill':
      case 'tool_call':
        return {
          station: event.station,
          tool: event.tool,
          kind: event.kind,
          count: 1,
          run: (repeats) => {
            mood('working')
            scene.sendActorTo(actorId, event.station)
            scene.drawLink(actorId, event.station, 0x7dd3fc, 900)
            const suffix = repeats > 1 ? ` ×${repeats}` : ''
            scene.flashStation(event.station, `${event.tool ?? ''}${suffix}\n${event.summary}`)
          },
        }
      case 'tool_result':
        return {
          station: event.station,
          tool: event.tool,
          kind: event.kind,
          count: 1,
          run: () => {
            if (event.isError) {
              mood('waiting')
              scene.actor(actorId)?.say(`⚠ ${event.summary}`, 4000)
            }
            scene.flashStation(event.station, `${event.tool ?? ''}\n${event.summary}`)
          },
        }
      case 'agent_spawn':
        return {
          kind: event.kind,
          count: 1,
          run: () => {
            const id = event.actor?.id ?? event.agentId
            if (!id) return
            const color = scene.colorForAgent(event.actor?.agentType, event.actor?.variant)
            scene.ensureActor({
              id,
              emoji: '👤',
              color,
              label: agentLabel(event.actor),
              subLabel: event.actor?.description,
              radius: 20,
              nearActorId: MAIN_ID,
            })
            this.registerAgentActor(id, event.actor)
            scene.drawLink(MAIN_ID, id, color, 1400)
            if (event.actor?.description) {
              scene.actor(id)?.say(event.actor.description, 5000)
            }
          },
        }
      case 'agent_done':
        return {
          kind: event.kind,
          count: 1,
          run: () => {
            const id = event.actor?.id ?? event.agentId
            if (!id) return
            scene.drawLink(id, MAIN_ID, 0x4ade80, 1400)
            scene.actor(id)?.setMood('idle')
            setTimeout(() => scene.removeActor(id), 1200)
          },
        }
      case 'permission':
        return {
          kind: event.kind,
          count: 1,
          run: () => {
            mood('waiting')
            scene.actor(actorId)?.say(`❗ ${event.summary}`, 8000)
          },
        }
      default:
        return null
    }
  }

  /** Se llama en cada frame: saca acciones de las colas respetando el ritmo. */
  tick(now: number): void {
    for (const [actorId, queue] of this.queues) {
      if (queue.length === 0) {
        const actor = this.scene.actor(actorId)
        if (actor) {
          actor.speed = 1
          if (actor.mood === 'working' && actor.distance < 4) actor.setMood('idle')
        }
        continue
      }

      const pending = queue.length
      const actor = this.scene.actor(actorId)
      if (actor) actor.speed = Math.min(4, 1 + pending * 0.4)

      const until = this.busyUntil.get(actorId) ?? 0
      if (now < until) continue

      const action = queue.shift()!
      action.run(action.count)
      const hold = Math.max(HOLD_MIN_MS, HOLD_BASE_MS / (1 + pending * 0.6))
      this.busyUntil.set(actorId, now + hold)
    }
  }

  /** Cuántas acciones quedan por representar (para avisar en el HUD si va por detrás). */
  get backlog(): number {
    let total = 0
    for (const queue of this.queues.values()) total += queue.length
    return total
  }
}
