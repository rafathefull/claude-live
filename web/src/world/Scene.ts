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

/** Grabado de la Mesa. «Los caballeros de la mesa cuadrada», por supuesto. */
const DESK_MOTTO = 'Aquí están reunidos los caballeros de la mesa cuadrada'

/**
 * Los doce asientos, en el orden en que se dibujan (lado a lado). Los nombres no se escriben
 * en el tablero —serían doce etiquetas de ruido—: aparecen al pasar el ratón por cada uno.
 */
const KNIGHTS: { name: string; quip: string }[] = [
  { name: 'Arturo, rey de los britanos', quip: 'Elegido por la Dama del Lago, según él. Sin caballo, pero con Patsy.' },
  { name: 'Sir Lancelot el Valiente', quip: 'Entusiasta hasta el exceso. No le encargues rescates delicados.' },
  { name: 'Sir Galahad el Puro', quip: 'Sobrevivió al castillo de Anthrax. A duras penas, y a su pesar.' },
  { name: 'Sir Bedevere el Sabio', quip: 'Autoridad en el peso de las brujas y en la carga de las golondrinas.' },
  { name: 'Sir Robin el No-tan-valiente', quip: 'Huyó del pollo gigante de Bristol. Dos veces.' },
  { name: 'Sir Gawain', quip: 'Sobrino del rey. Cortés hasta con quien va a decapitarlo.' },
  { name: 'Sir Percival', quip: 'El que pregunta lo que nadie se atreve a preguntar.' },
  { name: 'Sir Bors', quip: 'Se acercó al conejo. Que sirva de aviso: mira el Trastero.' },
  { name: 'Sir Ector', quip: 'Crió al rey sin saberlo, que es más de lo que puede decir cualquiera.' },
  { name: 'Sir Kay', quip: 'Hermano de leche del rey y quejica oficial de la mesa.' },
  { name: 'Sir Tristán', quip: 'Mejor arpista que espadachín, y eso ya es decir algo.' },
  { name: 'Sir No-Sale-en-esta-Película', quip: 'Su única aparición son los títulos de crédito.' },
]

interface StationView {
  meta: StationMeta
  view: Container
  glow: Graphics
  icon: Text
  name: Text
  counter: Text
  detail: Text
  flashUntil: number
  uses: number
  /** El Trastero muta cuando se acumulan herramientas sin sitio. */
  beastly?: boolean
}

/** A partir de estos usos, el Trastero deja de parecer inofensivo. */
const BEAST_THRESHOLD = 4

export class Scene {
  readonly app = new Application()
  /** La Mesa no es una estación con cartel: es la zona central donde viven los actores. */
  private deskLayer = new Container()
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
  private onVisibility?: () => void
  /** Zonas sensibles de los doce asientos, para poder saludar a cada caballero. */
  private knightHits: Container[] = []

  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x0b0d12,
      antialias: true,
      resizeTo: host,
      // Resolución 1 y 30 fps de techo: es un panel que se deja abierto durante horas, no un
      // juego. A doble resolución y 60 fps la GPU trabajaba cuatro veces más sin que se note.
      resolution: 1,
      autoDensity: true,
      powerPreference: 'low-power',
    })
    this.app.ticker.maxFPS = 30
    host.appendChild(this.app.canvas)
    this.deskLayer.addChild(this.deskZone)
    this.app.stage.addChild(this.deskLayer, this.linksLayer, this.stationsLayer, this.actorsLayer)

    // La Mesa se dibuja detrás de todo: un cartel en el centro taparía a los actores y sus
    // burbujas. Es cuadrada y lleva su rótulo grabado, en homenaje a Monty Python.
    this.deskLabel = new Text({
      text: DESK_MOTTO,
      style: {
        fontFamily: 'ui-monospace, monospace',
        fontSize: 26,
        fill: 0x2b3448,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 300,
        lineHeight: 32,
      },
    })
    this.deskLabel.anchor.set(0.5)
    this.deskLayer.addChild(this.deskLabel)

    for (const [index, knight] of KNIGHTS.entries()) {
      const hit = new Container()
      this.makeHoverable(hit, new Circle(0, 0, 19), () => ({
        icon: '🛡️',
        title: knight.name,
        body: knight.quip,
        extra: `asiento ${index + 1} de ${KNIGHTS.length} · mesa cuadrada`,
        color: '#a8bcd8',
      }))
      this.deskLayer.addChild(hit)
      this.knightHits.push(hit)
    }

    for (const meta of STATIONS) {
      if (meta.id === 'desk') continue
      this.stations.set(meta.id, this.buildStation(meta))
    }
    this.layout()
    this.app.renderer.on('resize', () => this.layout())
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS))

    // Con la pestaña en segundo plano no hay nada que mirar: parar el ticker evita tener el
    // mundo animándose (y calentando la máquina) mientras trabajas en otra ventana.
    this.onVisibility = () => {
      if (document.hidden) this.app.ticker.stop()
      else this.app.ticker.start()
    }
    document.addEventListener('visibilitychange', this.onVisibility)
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
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility)
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

    const station: StationView = {
      meta,
      view,
      glow,
      icon,
      name,
      counter,
      detail,
      flashUntil: 0,
      uses: 0,
    }
    // Ayuda contextual: lo mismo que cuenta la leyenda, sin salir del mundo.
    this.makeHoverable(
      view,
      new Rectangle(-PLATE_W / 2 - 8, -PLATE_H / 2 - 8, PLATE_W + 16, PLATE_H + 16),
      () => ({
        icon: station.beastly ? '🐰' : meta.icon,
        title: station.beastly ? 'Caerbannog' : meta.label,
        body: station.beastly
          ? 'Sigue siendo el Trastero: herramientas que no tienen sitio propio en el mundo. Pero ya van unas cuantas, y ese conejo de aspecto inofensivo es en realidad una bestia de dientes afilados. Añádelas a shared/mapping.ts antes de que salte.'
          : meta.help,
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
    this.relocateActors()
  }

  /**
   * Rosetón central, al estilo de un grabado antiguo: círculos concéntricos, ocho pétalos y
   * radios finos. Va en la capa de fondo y con muy poca opacidad, para que sea una textura y
   * no un dibujo que compita con lo que pasa encima.
   */
  private drawEngraving(cx: number, cy: number, radius: number): void {
    const g = this.deskZone
    const ink = { width: 1, color: 0x7dd3fc, alpha: 0.05 } as const

    for (const factor of [1, 0.72, 0.34, 0.12]) {
      g.circle(cx, cy, radius * factor).stroke(ink)
    }

    // Ocho pétalos: arcos que nacen y mueren en el círculo interior.
    const petals = 8
    for (let index = 0; index < petals; index++) {
      const angle = (index / petals) * Math.PI * 2
      const inner = radius * 0.34
      const outer = radius * 0.72
      const x1 = cx + Math.cos(angle) * inner
      const y1 = cy + Math.sin(angle) * inner
      const x2 = cx + Math.cos(angle + Math.PI / petals) * outer
      const y2 = cy + Math.sin(angle + Math.PI / petals) * outer
      const x3 = cx + Math.cos(angle + (2 * Math.PI) / petals) * inner
      const y3 = cy + Math.sin(angle + (2 * Math.PI) / petals) * inner
      g.moveTo(x1, y1).quadraticCurveTo(x2, y2, x3, y3).stroke(ink)
    }

    // Radios cortos entre los dos círculos exteriores.
    const spokes = 24
    for (let index = 0; index < spokes; index++) {
      const angle = (index / spokes) * Math.PI * 2
      g.moveTo(cx + Math.cos(angle) * radius * 0.72, cy + Math.sin(angle) * radius * 0.72)
        .lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
        .stroke(ink)
    }
  }

  /** Caballeros sentados a los cuatro lados, mirando al centro. Tres por lado. */
  private drawKnights(cx: number, cy: number, half: number): void {
    const perSide = 3
    const inset = half - 16
    const spread = half * 0.58

    for (let side = 0; side < 4; side++) {
      // 0 arriba, 1 derecha, 2 abajo, 3 izquierda. `toCentre` es hacia dónde miran.
      const angle = (side * Math.PI) / 2
      const nx = Math.sin(angle)
      const ny = -Math.cos(angle)
      for (let seat = 0; seat < perSide; seat++) {
        const offset = (seat - (perSide - 1) / 2) * ((spread * 2) / perSide)
        const x = cx + nx * inset - ny * offset
        const y = cy + ny * inset + nx * offset
        this.drawKnight(x, y, Math.atan2(-ny, -nx))
        this.knightHits[side * perSide + seat]?.position.set(x, y)
      }
    }
  }

  /**
   * Un caballero visto desde arriba: la espalda es un semicírculo abierto hacia el centro, con
   * el casco dentro y una lanza corta apoyada. `toCentre` en radianes.
   *
   * Cada trazo empieza con su propio `moveTo`: `arc` enlaza con una línea desde el punto
   * anterior, así que sin eso los caballeros salían cosidos unos a otros con lanzas kilométricas.
   */
  private drawKnight(x: number, y: number, toCentre: number): void {
    const g = this.deskZone
    const line = { width: 1.4, color: 0xa8bcd8, alpha: 0.28 } as const
    const ox = Math.cos(toCentre)
    const oy = Math.sin(toCentre)
    const px = -oy
    const py = ox
    const back = toCentre + Math.PI
    const from = back - Math.PI / 2
    const to = back + Math.PI / 2

    // Espalda y hombros.
    g.moveTo(x + Math.cos(from) * 12, y + Math.sin(from) * 12)
      .arc(x, y, 12, from, to)
      .stroke(line)
    // Casco y cimera, mirando al tablero.
    g.circle(x + ox * 2, y + oy * 2, 6.5).stroke({ ...line, alpha: 0.36 })
    g.moveTo(x + ox * 8, y + oy * 8)
      .lineTo(x + ox * 11, y + oy * 11)
      .stroke({ ...line, alpha: 0.36 })
    // Lanza apoyada en el hombro: corta, o se come la escena.
    g.moveTo(x + px * 13 + ox * 2, y + py * 13 + oy * 2)
      .lineTo(x + px * 15 - ox * 14, y + py * 15 - oy * 14)
      .stroke({ ...line, alpha: 0.2 })
  }

  /**
   * Recoloca a los actores tras un cambio de tamaño. Las estaciones se mueven con la ventana,
   * así que un actor que conserve su píxel de antes acaba plantado en otro sitio: aquí se
   * recalcula desde su estación y hueco, o desde su fracción del escenario.
   */
  private relocateActors(): void {
    const compact = this.width < 1200
    for (const actor of this.actors.values()) {
      actor.setCompact(compact)
      if (actor.homeStation) {
        const { x, y } = this.slotPosition(actor.homeStation as StationId, actor.homeSlot)
        actor.place(x, y)
      } else if (actor.homeFraction) {
        actor.place(actor.homeFraction.x * this.width, actor.homeFraction.y * this.height)
      }
    }
  }

  /** La mesa cuadrada de la zona central: tablero, grabado y los caballeros sentados. */
  private drawDeskZone(): void {
    const { x, y } = this.positionOf('desk')
    const half = Math.min(this.width * 0.19, this.height * 0.26)
    const size = half * 2
    const g = this.deskZone
    g.clear()
      .roundRect(x - half, y - half, size, size, 10)
      .fill({ color: 0x7dd3fc, alpha: 0.016 })
      .roundRect(x - half, y - half, size, size, 10)
      .stroke({ width: 1, color: 0x1c2230, alpha: 0.55 })
    // Filete interior, como el de un tablero labrado.
    g.roundRect(x - half + 9, y - half + 9, size - 18, size - 18, 8)
      .stroke({ width: 1, color: 0x1a2030, alpha: 0.5 })

    this.drawEngraving(x, y, half * 0.78)
    this.drawKnights(x, y, half)

    if (!this.deskLabel) return
    // El rótulo se encoge con la mesa y desaparece cuando ya no cabe con dignidad.
    const fontSize = Math.max(13, Math.min(26, half * 0.16))
    this.deskLabel.style.fontSize = fontSize
    this.deskLabel.style.lineHeight = fontSize * 1.25
    this.deskLabel.style.wordWrapWidth = size * 0.82
    this.deskLabel.visible = half > 110
    this.deskLabel.position.set(x, y)
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

    // Guiño: un Trastero que se llena es un problema real (herramientas sin mapear), así que
    // se hace notar. El de Caerbannog parecía inofensivo también.
    if (id === 'unknown' && !station.beastly && station.uses >= BEAST_THRESHOLD) {
      station.beastly = true
      station.icon.text = '🐰'
      station.name.text = 'Caerbannog'
    }
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
    if (anchor) {
      // Los recién nacidos esperan en semicírculo delante de quien los lanzó, hasta que su
      // primera herramienta los manda a una estación. Antes se colocaban con un
      // desplazamiento aleatorio y salían casi encima de Claude, como pegotes en la Mesa.
      const waiting = [...this.actors.values()].filter(
        (peer) => peer !== actor && peer !== anchor && !peer.homeStation,
      ).length
      const angle = -Math.PI / 2 + (waiting - 1) * 0.55
      const radius = 96
      actor.place(anchor.view.x + Math.cos(angle) * radius, anchor.view.y - Math.sin(angle) * radius + 40)
    } else {
      const start = this.positionOf(opts.at ?? 'desk')
      actor.place(start.x, start.y)
    }
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

  /** Todos los actores que hay en el escenario ahora mismo. */
  actorIds(): string[] {
    return [...this.actors.keys()]
  }

  removeActor(id: string): void {
    this.actors.get(id)?.hide()
  }

  /**
   * Punto de un hueco concreto delante de una estación. Tres por fila, separados lo bastante
   * para que las etiquetas de dos líneas no se pisen (con 44 px de paso eran ilegibles).
   */
  private slotPosition(station: StationId, slot: number): { x: number; y: number } {
    const spot = this.positionOf(station)
    // El paso se encoge en ventanas estrechas y el resultado se mantiene dentro del lienzo:
    // con un paso fijo, los huecos de las estaciones pegadas al borde caían fuera de pantalla.
    const step = Math.max(58, Math.min(104, this.width * 0.075))
    const margin = 66
    const x = spot.x + ((slot % 3) - 1) * step
    const y = spot.y + PLATE_H / 2 + 30 + Math.floor(slot / 3) * 74
    return {
      x: Math.max(margin, Math.min(this.width - margin, x)),
      y: Math.max(50, Math.min(this.height - 56, y)),
    }
  }

  /** Coloca a un actor en una estación, repartiendo el sitio si hay varios. */
  sendActorTo(id: string, station: StationId): void {
    const actor = this.actors.get(id)
    if (!actor) return
    const peers = [...this.actors.values()].filter((a) => a !== actor)

    // Se busca un hueco comparando con el destino de los demás, no con el centro de la
    // estación: comparar contra el centro dejaba a dos subagentes exactamente encima.
    const taken = (x: number, y: number): boolean =>
      peers.some((peer) => Math.hypot(peer.targetX - x, peer.targetY - y) < 54)

    for (let slot = 0; slot < 12; slot++) {
      const { x, y } = this.slotPosition(station, slot)
      if (!taken(x, y)) {
        actor.homeStation = station
        actor.homeSlot = slot
        actor.homeFraction = undefined
        actor.moveTo(x, y)
        return
      }
    }
    actor.homeStation = station
    actor.homeSlot = 0
    actor.homeFraction = undefined
    const fallback = this.slotPosition(station, 0)
    actor.moveTo(fallback.x, fallback.y)
  }

  /** Sitio fijo expresado en fracciones del escenario, para el usuario y para Claude. */
  placeAtFraction(id: string, fx: number, fy: number): void {
    const actor = this.actors.get(id)
    if (!actor) return
    actor.homeFraction = { x: fx, y: fy }
    actor.homeStation = undefined
    actor.place(fx * this.width, fy * this.height)
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

    const hadLinks = this.links.length > 0
    this.links = this.links.filter((link) => link.until > now)
    if (hadLinks || this.links.length > 0) this.linksLayer.clear()
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
