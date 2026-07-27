import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js'
import { inkFor, palette } from './palette'

/**
 * Un habitante del mundo: el usuario, Claude o un subagente.
 * Arte procedimental (círculos + emoji), sin ficheros externos.
 */

export type ActorMood = 'idle' | 'thinking' | 'working' | 'waiting' | 'talking'

// Los estilos son funciones y no constantes: el color de los rótulos depende del tema, y la
// escena se rehace al cambiarlo.
const labelStyle = (): TextStyleOptions => ({
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  fill: palette().actorLabel,
  align: 'center',
})

const subLabelStyle = (): TextStyleOptions => ({
  fontFamily: 'ui-monospace, monospace',
  fontSize: 10,
  fill: palette().actorSubLabel,
  align: 'center',
  wordWrap: true,
  wordWrapWidth: 96,
  breakWords: true,
})

const bubbleStyle = (): TextStyleOptions => ({
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  fill: palette().bubbleText,
  wordWrap: true,
  wordWrapWidth: 240,
  breakWords: true,
})

/**
 * Insignia de estado: se superpone al avatar sin sustituirlo, para que el estado se lea de un
 * vistazo sin perder de vista quién es cada actor. El anillo de color sigue estando.
 */
export const MOOD_EMOJI: Record<ActorMood, string> = {
  idle: '',
  thinking: '🧠',
  working: '🔧',
  waiting: '❗',
  talking: '💬',
}

/** Color del anillo por estado. Exportado para que la leyenda no duplique valores. */
export const MOOD_RING: Record<ActorMood, number> = {
  idle: 0x3a4356,
  thinking: 0x7dd3fc,
  working: 0x4ade80,
  waiting: 0xfbbf24,
  talking: 0xb07cff,
}

export class Actor {
  readonly view = new Container()
  /** Qué mostrar al pasar el ratón por encima. */
  tooltipTitle = ''
  tooltipBody = ''
  /**
   * Dónde «vive» el actor, en términos del escenario y no en píxeles: la estación y el hueco
   * que ocupa, o una fracción del ancho y el alto para los que no van a ninguna estación.
   * Sin esto, al redimensionar la ventana los actores se quedaban en su píxel de antes y
   * acababan plantados en medio de otro sitio.
   */
  homeStation?: string
  homeSlot = 0
  homeFraction?: { x: number; y: number }
  /** Posición objetivo; el ticker interpola hacia ella. */
  targetX = 0
  targetY = 0
  /** Multiplicador de velocidad, que el director sube cuando hay atasco. */
  speed = 1
  mood: ActorMood = 'idle'
  dying = false

  private body = new Graphics()
  private ring = new Graphics()
  private face: Text
  private badge: Text
  private badgeBg = new Graphics()
  private label: Text
  private subLabel: Text
  private bubble = new Container()
  private bubbleBg = new Graphics()
  private bubbleText: Text
  private bubbleUntil = 0
  private bubbleHeight = 0
  private bubbleBelow = false
  private ringMood?: ActorMood
  private born = 0
  private spawnProgress = 0

  constructor(
    readonly id: string,
    emoji: string,
    private color: number,
    labelText: string,
    private radius = 24,
  ) {
    this.face = new Text({ text: emoji, style: { fontSize: radius * 1.15, fill: palette().faceFill } })
    this.face.anchor.set(0.5)
    this.label = new Text({ text: labelText, style: { ...labelStyle(), fill: color } })
    this.label.anchor.set(0.5, 0)
    this.label.y = radius + 7

    // Segunda línea: el cometido del actor. Sin ella, dos subagentes del mismo tipo son
    // dos círculos iguales y no hay forma de saber cuál hace qué.
    this.subLabel = new Text({ text: '', style: subLabelStyle() })
    this.subLabel.anchor.set(0.5, 0)
    this.subLabel.y = radius + 21

    // La insignia va en la esquina superior derecha, con un disco detrás para que se lea
    // sobre el borde del avatar.
    this.badge = new Text({ text: '', style: { fontSize: Math.max(13, radius * 0.62) } })
    this.badge.anchor.set(0.5)
    const badgeX = radius * 0.78
    const badgeY = -radius * 0.78
    this.badge.position.set(badgeX, badgeY)
    this.badgeBg
      .circle(badgeX, badgeY, Math.max(9, radius * 0.44))
      .fill({ color: palette().bubbleBg, alpha: 0.95 })
    this.badgeBg.visible = false

    this.bubbleText = new Text({ text: '', style: bubbleStyle() })
    this.bubbleText.position.set(8, 6)
    this.bubble.addChild(this.bubbleBg, this.bubbleText)
    this.bubble.visible = false

    this.draw()
    this.view.addChild(
      this.ring,
      this.body,
      this.face,
      this.badgeBg,
      this.badge,
      this.label,
      this.subLabel,
      this.bubble,
    )
    this.view.scale.set(0)
  }

  private draw(): void {
    this.body.clear().circle(0, 0, this.radius).fill({ color: palette().actorBody })
    this.body.circle(0, 0, this.radius).stroke({ width: 2, color: this.color, alpha: 0.9 })
  }

  setLabel(text: string): void {
    this.label.text = text
    this.tooltipTitle = text
  }

  /** El tipo del subagente llega después de su nacimiento: hay que poder recolorearlo. */
  setColor(color: number): void {
    if (color === this.color) return
    this.color = color
    this.label.style.fill = color
    this.draw()
  }

  /** Segunda línea con el cometido del actor (la descripción con la que se lanzó). */
  setSubLabel(text: string): void {
    this.subLabel.text = text.length > 38 ? `${text.slice(0, 37)}…` : text
    this.tooltipBody = text
  }

  /**
   * En ventanas estrechas la segunda línea se esconde: con los actores tan juntos, los
   * cometidos se superponían y no se leía ninguno. Siguen en el tooltip y en las píldoras.
   */
  setCompact(compact: boolean): void {
    this.subLabel.visible = !compact
  }

  setMood(mood: ActorMood): void {
    this.mood = mood
  }

  /** Coloca al actor de golpe (al nacer). */
  place(x: number, y: number): void {
    this.view.position.set(x, y)
    this.targetX = x
    this.targetY = y
  }

  moveTo(x: number, y: number): void {
    this.targetX = x
    this.targetY = y
  }

  say(text: string, ms = 4200): void {
    this.bubbleText.text = text.length > 170 ? `${text.slice(0, 169)}…` : text
    const width = Math.min(240, this.bubbleText.width + 16)
    this.bubbleHeight = this.bubbleText.height + 12
    this.bubbleBg
      .clear()
      .roundRect(0, 0, width, this.bubbleHeight, 8)
      .fill({ color: palette().bubbleBg, alpha: 0.92 })
      .roundRect(0, 0, width, this.bubbleHeight, 8)
      .stroke({ width: 1, color: this.color, alpha: 0.6 })
    this.placeBubble()
    this.bubble.visible = true
    this.bubbleUntil = performance.now() + ms
  }

  /**
   * Debajo del actor cuando está en la parte alta del escenario, para no tapar el cartel de
   * la estación en la que trabaja; encima en el resto de los casos.
   */
  setBubbleBelow(below: boolean): void {
    if (below === this.bubbleBelow) return
    this.bubbleBelow = below
    this.placeBubble()
  }

  private placeBubble(): void {
    const y = this.bubbleBelow
      ? this.radius + this.label.height + this.subLabel.height + 12
      : -this.bubbleHeight - this.radius
    this.bubble.position.set(this.radius + 8, y)
  }

  hide(): void {
    this.dying = true
  }

  get alive(): boolean {
    return this.view.scale.x > 0.02 || !this.dying
  }

  /** Distancia al destino, en píxeles. */
  get distance(): number {
    const dx = this.targetX - this.view.x
    const dy = this.targetY - this.view.y
    return Math.hypot(dx, dy)
  }

  update(deltaMs: number, now: number): void {
    if (this.born === 0) this.born = now

    // Aparición / desaparición
    const targetScale = this.dying ? 0 : 1
    this.spawnProgress += ((targetScale - this.spawnProgress) * deltaMs) / 140
    const eased = Math.max(0, Math.min(1, this.spawnProgress))
    this.view.scale.set(eased)
    this.view.alpha = eased

    // Desplazamiento suave hacia el destino
    const dx = this.targetX - this.view.x
    const dy = this.targetY - this.view.y
    const step = Math.min(1, (deltaMs / 260) * this.speed)
    this.view.x += dx * step
    this.view.y += dy * step

    // Balanceo sutil para que el mundo no parezca congelado
    const t = (now - this.born) / 1000
    this.face.y = Math.sin(t * 2.4) * 1.4

    // Insignia del estado: 🧠 pensando, 🔧 trabajando, 💬 hablando, ❗ esperando
    const badge = MOOD_EMOJI[this.mood]
    this.badge.text = badge
    this.badge.visible = badge !== ''
    this.badgeBg.visible = badge !== ''
    if (badge) this.badge.scale.set(1 + Math.sin(t * 6) * 0.06)

    // Anillo de estado: la geometría se rehace solo al cambiar de estado; el latido es
    // alpha y escala, que no cuestan nada.
    if (this.ringMood !== this.mood) {
      this.ringMood = this.mood
      this.ring
        .clear()
        .circle(0, 0, this.radius + 6)
        .stroke({ width: 2, color: inkFor(MOOD_RING[this.mood]) })
    }
    const pulse = this.mood === 'idle' ? 0 : (Math.sin(t * 5) + 1) / 2
    this.ring.alpha = 0.25 + pulse * 0.45
    this.ring.scale.set(1 + pulse * 0.05)

    if (this.bubble.visible && now > this.bubbleUntil) this.bubble.visible = false
  }

  destroy(): void {
    this.view.destroy({ children: true })
  }
}
