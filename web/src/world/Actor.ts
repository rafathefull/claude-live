import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js'

/**
 * Un habitante del mundo: el usuario, Claude o un subagente.
 * Arte procedimental (círculos + emoji), sin ficheros externos.
 */

export type ActorMood = 'idle' | 'thinking' | 'working' | 'waiting' | 'talking'

const LABEL_STYLE: TextStyleOptions = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  fill: 0x8b95a8,
  align: 'center',
}

const BUBBLE_STYLE: TextStyleOptions = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  fill: 0xdde3ee,
  wordWrap: true,
  wordWrapWidth: 240,
  breakWords: true,
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
  private label: Text
  private bubble = new Container()
  private bubbleBg = new Graphics()
  private bubbleText: Text
  private bubbleUntil = 0
  private born = 0
  private spawnProgress = 0

  constructor(
    readonly id: string,
    private emoji: string,
    private color: number,
    labelText: string,
    private radius = 24,
  ) {
    this.face = new Text({ text: emoji, style: { fontSize: radius * 1.15, fill: 0xffffff } })
    this.face.anchor.set(0.5)
    this.label = new Text({ text: labelText, style: LABEL_STYLE })
    this.label.anchor.set(0.5, 0)
    this.label.y = radius + 7

    this.bubbleText = new Text({ text: '', style: BUBBLE_STYLE })
    this.bubbleText.position.set(8, 6)
    this.bubble.addChild(this.bubbleBg, this.bubbleText)
    this.bubble.visible = false

    this.draw()
    this.view.addChild(this.ring, this.body, this.face, this.label, this.bubble)
    this.view.scale.set(0)
  }

  private draw(): void {
    this.body.clear().circle(0, 0, this.radius).fill({ color: 0x171b24 })
    this.body.circle(0, 0, this.radius).stroke({ width: 2, color: this.color, alpha: 0.9 })
  }

  setLabel(text: string): void {
    this.label.text = text
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
    this.bubbleText.text = text.length > 240 ? `${text.slice(0, 239)}…` : text
    const width = Math.min(256, this.bubbleText.width + 16)
    const height = this.bubbleText.height + 12
    this.bubbleBg
      .clear()
      .roundRect(0, 0, width, height, 8)
      .fill({ color: 0x0b0d12, alpha: 0.92 })
      .roundRect(0, 0, width, height, 8)
      .stroke({ width: 1, color: this.color, alpha: 0.6 })
    this.bubble.position.set(this.radius + 8, -height - this.radius)
    this.bubble.visible = true
    this.bubbleUntil = performance.now() + ms
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
    this.face.text = this.emoji

    // Anillo de estado, pulsando cuando piensa o trabaja
    const pulse = this.mood === 'idle' ? 0 : (Math.sin(t * 5) + 1) / 2
    const ringRadius = this.radius + 5 + pulse * 3
    this.ring
      .clear()
      .circle(0, 0, ringRadius)
      .stroke({ width: 2, color: MOOD_RING[this.mood], alpha: 0.25 + pulse * 0.45 })

    if (this.bubble.visible && now > this.bubbleUntil) this.bubble.visible = false
  }

  destroy(): void {
    this.view.destroy({ children: true })
  }
}
