import {
  Application,
  Circle,
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from 'pixi.js'
import { STATIONS, colorForAgent, toolsForStation, type StationMeta } from '@shared/mapping'
import type { StationId } from '@shared/types'
import { Actor, MOOD_EMOJI, MOOD_RING } from './Actor'

/** Lo que se muestra al pasar el ratón por un elemento del escenario. */
export interface HoverInfo {
  icon: string
  title: string
  body: string
  extra?: string
  color?: string
}

/** Estado del actor en palabras, para el tooltip. */
const MOOD_TEXT: Record<keyof typeof MOOD_RING, string> = {
  idle: 'quieto',
  thinking: 'pensando',
  working: 'trabajando',
  waiting: 'esperando',
  talking: 'hablando',
}

/**
 * El escenario: estaciones fijas alrededor y actores que se mueven entre ellas.
 * Las posiciones de `STATIONS` son relativas (0..1) para que el mundo se adapte al tamaño.
 */

/** Tamaño del cartel de una estación. */
const PLATE_W = 116
const PLATE_H = 68

interface StationView {
  meta: StationMeta
  view: Container
  glow: Graphics
  counter: Text
  detail: Text
  flashUntil: number
  uses: number
}

export class Scene {
  readonly app = new Application()
  /** La Mesa no es una estación con cartel: es la zona central donde viven los actores. */
  private deskZone = new Graphics()
  private deskLabel?: Text
  private stationsLayer = new Container()
  private linksLayer = new Graphics()
  private actorsLayer = new Container()
  private stations = new Map<StationId, StationView>()
  private actors = new Map<string, Actor>()
  private links: { from: string; to: StationId | string; until: number; color: number }[] = []
  private width = 0
  private height = 0
  private hoverHandler?: (info: HoverInfo | null, x: number, y: number) => void

  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x0b0d12,
      antialias: true,
      resizeTo: host,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    host.appendChild(this.app.canvas)
    this.app.stage.addChild(this.deskZone, this.linksLayer, this.stationsLayer, this.actorsLayer)

    // La Mesa se dibuja como una alfombra tenue detrás de todo: marcar el centro con un
    // cartel volvería a tapar a los actores y sus burbujas, que es justo lo que pasa ahí.
    const desk = STATIONS.find((meta) => meta.id === 'desk')
    if (desk) {
      this.deskLabel = new Text({
        text: `${desk.icon} ${desk.label}`,
        style: { fontFamily: 'ui-monospace, monospace', fontSize: 11, fill: 0x3a4356 },
      })
      this.deskLabel.anchor.set(0.5, 1)
      this.app.stage.addChild(this.deskLabel)
    }

    for (const meta of STATIONS) {
      if (meta.id === 'desk') continue
      this.stations.set(meta.id, this.buildStation(meta))
    }
    this.layout()
    this.app.renderer.on('resize', () => this.layout())
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS))
  }

  /** El front pinta el tooltip en HTML: aquí solo se dice qué hay bajo el cursor y dónde. */
  setHoverHandler(handler: (info: HoverInfo | null, x: number, y: number) => void): void {
    this.hoverHandler = handler
  }

  private emitHover(info: HoverInfo | null, event?: FederatedPointerEvent): void {
    this.hoverHandler?.(info, event?.global.x ?? 0, event?.global.y ?? 0)
  }

  /** Hace que un objeto responda al ratón y publique su ayuda al pasar por encima. */
  private makeHoverable(target: Container, hitArea: Rectangle | Circle, info: () => HoverInfo): void {
    target.eventMode = 'static'
    target.cursor = 'help'
    target.hitArea = hitArea
    target.on('pointerover', (event: FederatedPointerEvent) => this.emitHover(info(), event))
    target.on('pointermove', (event: FederatedPointerEvent) => this.emitHover(info(), event))
    target.on('pointerout', () => this.emitHover(null))
  }

  destroy(): void {
    this.app.destroy(true, { children: true })
  }

  // ------------------------------------------------------------- estaciones

  private buildStation(meta: StationMeta): StationView {
    const view = new Container()
    const glow = new Graphics()
    const plate = new Graphics()
    plate.roundRect(-PLATE_W / 2, -PLATE_H / 2, PLATE_W, PLATE_H, 12).fill({ color: 0x11141b })
    plate
      .roundRect(-PLATE_W / 2, -PLATE_H / 2, PLATE_W, PLATE_H, 12)
      .stroke({ width: 1, color: 0x232936 })

    const icon = new Text({ text: meta.icon, style: { fontSize: 34 } })
    icon.anchor.set(0.5)
    icon.y = -12

    const name = new Text({
      text: meta.label,
      style: { fontFamily: 'ui-monospace, monospace', fontSize: 12, fill: 0x8b95a8 },
    })
    name.anchor.set(0.5)
    name.y = 18

    // El contador va dentro del cartel: el hueco de debajo es por donde llegan los actores.
    const counter = new Text({
      text: '',
      style: { fontFamily: 'ui-monospace, monospace', fontSize: 11, fill: 0x5b6474 },
    })
    counter.anchor.set(1, 0)
    counter.position.set(PLATE_W / 2 - 8, -PLATE_H / 2 + 5)

    // Y el detalle encima, por el mismo motivo.
    const detail = new Text({
      text: '',
      style: {
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        fill: 0x7dd3fc,
        wordWrap: true,
        wordWrapWidth: 180,
        breakWords: true,
        align: 'center',
      },
    })
    detail.anchor.set(0.5, 1)
    detail.y = -PLATE_H / 2 - 6

    view.addChild(glow, plate, icon, name, counter, detail)
    this.stationsLayer.addChild(view)

    const station: StationView = { meta, view, glow, counter, detail, flashUntil: 0, uses: 0 }
    // Ayuda contextual: lo mismo que cuenta la leyenda, sin salir del mundo.
    this.makeHoverable(
      view,
      new Rectangle(-PLATE_W / 2 - 8, -PLATE_H / 2 - 8, PLATE_W + 16, PLATE_H + 16),
      () => ({
        icon: meta.icon,
        title: meta.label,
        body: meta.help,
        extra: [
          station.uses > 0 ? `usada ${station.uses} ${station.uses === 1 ? 'vez' : 'veces'}` : '',
          toolsForStation(meta.id).join(' · '),
        ]
          .filter(Boolean)
          .join(' — '),
      }),
    )
    return station
  }

  private layout(): void {
    this.width = this.app.screen.width
    this.height = this.app.screen.height
    for (const station of this.stations.values()) {
      const { x, y } = this.positionOf(station.meta.id)
      station.view.position.set(x, y)
    }
    this.drawDeskZone()
  }

  /** Alfombra de la zona central, con su nombre pegado al borde para no estorbar. */
  private drawDeskZone(): void {
    const { x, y } = this.positionOf('desk')
    const rx = this.width * 0.19
    const ry = this.height * 0.24
    this.deskZone
      .clear()
      .ellipse(x, y, rx, ry)
      .fill({ color: 0x7dd3fc, alpha: 0.016 })
      .ellipse(x, y, rx, ry)
      .stroke({ width: 1, color: 0x1c2230, alpha: 0.55 })
    this.deskLabel?.position.set(x - rx + 40, y + ry + 14)
  }

  /** Punto del escenario para una estación (o la mesa si no existe). */
  positionOf(id: StationId): { x: number; y: number } {
    const meta = STATIONS.find((s) => s.id === id) ?? STATIONS.find((s) => s.id === 'desk')!
    return { x: meta.x * this.width, y: meta.y * this.height }
  }

  /** Marca actividad en una estación: destello + contador + etiqueta de lo que se hace. */
  flashStation(id: StationId, detail?: string): void {
    const station = this.stations.get(id)
    if (!station) return
    station.uses++
    station.counter.text = `×${station.uses}`
    station.flashUntil = performance.now() + 900
    if (detail !== undefined) {
      // Corto: el cartel es un rótulo, no un visor de logs. El detalle completo está en la
      // timeline y en el inspector.
      station.detail.text = detail.length > 58 ? `${detail.slice(0, 57)}…` : detail
    }
  }

  // ------------------------------------------------------------- actores

  ensureActor(opts: {
    id: string
    emoji: string
    color: number
    label: string
    /** Segunda línea: el cometido del actor. */
    subLabel?: string
    radius?: number
    at?: StationId
    nearActorId?: string
  }): Actor {
    const existing = this.actors.get(opts.id)
    if (existing) {
      existing.dying = false
      // El tipo, el color y el cometido llegan más tarde que el actor: el tool_result que lo
      // anuncia solo trae el id, y el tipo aparece con su .meta.json.
      if (opts.label) existing.setLabel(opts.label)
      existing.setColor(opts.color)
      if (opts.subLabel) existing.setSubLabel(opts.subLabel)
      return existing
    }
    const actor = new Actor(opts.id, opts.emoji, opts.color, opts.label, opts.radius ?? 24)
    if (opts.subLabel) actor.setSubLabel(opts.subLabel)
    const anchor = opts.nearActorId ? this.actors.get(opts.nearActorId) : undefined
    const start = anchor
      ? { x: anchor.view.x, y: anchor.view.y }
      : this.positionOf(opts.at ?? 'desk')
    actor.place(start.x + (Math.random() - 0.5) * 30, start.y + (Math.random() - 0.5) * 20)
    actor.tooltipTitle = opts.label
    actor.tooltipBody = opts.subLabel ?? ''
    this.makeHoverable(actor.view, new Circle(0, 0, (opts.radius ?? 24) + 6), () => ({
      icon: opts.emoji,
      title: actor.tooltipTitle,
      body: actor.tooltipBody || 'Sin tarea asignada.',
      extra: `estado: ${MOOD_EMOJI[actor.mood]} ${MOOD_TEXT[actor.mood]}`.trim(),
      color: `#${opts.color.toString(16).padStart(6, '0')}`,
    }))
    this.actors.set(opts.id, actor)
    this.actorsLayer.addChild(actor.view)
    return actor
  }

  actor(id: string): Actor | undefined {
    return this.actors.get(id)
  }

  removeActor(id: string): void {
    this.actors.get(id)?.hide()
  }

  /** Coloca a un actor en una estación, repartiendo el sitio si hay varios. */
  sendActorTo(id: string, station: StationId): void {
    const actor = this.actors.get(id)
    if (!actor) return
    const spot = this.positionOf(station)
    const peers = [...this.actors.values()].filter((a) => a !== actor)

    // Se busca un hueco comparando con el destino de los demás, no con el centro de la
    // estación: comparar contra el centro dejaba a dos subagentes exactamente encima.
    const taken = (x: number, y: number): boolean =>
      peers.some((peer) => Math.hypot(peer.targetX - x, peer.targetY - y) < 42)

    // Tres huecos por fila, separados lo suficiente para que las etiquetas de dos líneas no
    // se pisen: con 44 px de paso, tres subagentes en la misma estación eran ilegibles.
    const baseY = spot.y + PLATE_H / 2 + 30
    for (let slot = 0; slot < 12; slot++) {
      const x = spot.x + ((slot % 3) - 1) * 104
      const y = baseY + Math.floor(slot / 3) * 74
      if (!taken(x, y)) {
        actor.moveTo(x, y)
        return
      }
    }
    actor.moveTo(spot.x, baseY)
  }

  /** Línea temporal entre un actor y una estación (o entre dos actores). */
  drawLink(fromActorId: string, to: StationId | string, color = 0x7dd3fc, ms = 700): void {
    this.links.push({ from: fromActorId, to, until: performance.now() + ms, color })
  }

  colorForAgent(agentType: string | undefined, variant = 0): number {
    return colorForAgent(agentType, variant)
  }

  // ------------------------------------------------------------- ticker

  private tick(deltaMs: number): void {
    const now = performance.now()

    for (const [id, actor] of this.actors) {
      // Arriba del escenario los carteles están por encima del actor: la burbuja se va abajo.
      actor.setBubbleBelow(actor.view.y < this.height * 0.42)
      actor.update(deltaMs, now)
      if (actor.dying && actor.view.scale.x < 0.03) {
        this.actorsLayer.removeChild(actor.view)
        actor.destroy()
        this.actors.delete(id)
      }
    }

    for (const station of this.stations.values()) {
      const remaining = station.flashUntil - now
      const intensity = remaining > 0 ? remaining / 900 : 0
      station.glow.clear()
      if (intensity > 0) {
        station.glow
          .roundRect(-PLATE_W / 2 - 7, -PLATE_H / 2 - 7, PLATE_W + 14, PLATE_H + 14, 14)
          .fill({ color: 0x7dd3fc, alpha: 0.06 + intensity * 0.16 })
      }
      if (remaining < -6000 && station.detail.text) station.detail.text = ''
    }

    this.linksLayer.clear()
    this.links = this.links.filter((link) => link.until > now)
    for (const link of this.links) {
      const from = this.actors.get(link.from)
      if (!from) continue
      const target = this.actors.get(link.to) ?? null
      const point = target
        ? { x: target.view.x, y: target.view.y }
        : this.positionOf(link.to as StationId)
      const alpha = Math.max(0, (link.until - now) / 700) * 0.5
      this.linksLayer
        .moveTo(from.view.x, from.view.y)
        .lineTo(point.x, point.y)
        .stroke({ width: 1.5, color: link.color, alpha })
    }
  }
}
