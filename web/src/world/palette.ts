import { theme } from '../theme'

/**
 * Colores del escenario, en el formato que quiere Pixi (números, no cadenas CSS).
 *
 * Las variables CSS no sirven aquí: el canvas no las hereda. Se mantiene el equivalente de
 * cada tono para los dos temas, y la escena se rehace al cambiar de tema igual que al
 * cambiar de idioma.
 *
 * Los colores de estado y de tipo de agente NO están aquí: son los mismos en ambos temas a
 * propósito (verde = trabajando, azul = Explore) y se leen desde `Actor` y `mapping`.
 */

export type Palette = {
  /** Fondo del canvas. */
  bg: number
  /** Placa de cada estación y su borde. */
  plate: number
  plateBorder: number
  /** Rótulo, detalle y contador de la placa. */
  plateLabel: number
  plateDetail: number
  /** Trazos de la Mesa y del grabado. */
  deskFill: number
  deskFillAlpha: number
  deskLine: number
  deskLineSoft: number
  motto: number
  ink: number
  inkAlpha: number
  /** Caballeros: normal y resaltado al pasar por encima. */
  knight: number
  knightHot: number
  crest: number
  crestHot: number
  /** Actores: cuerpo, etiquetas y burbuja. */
  actorBody: number
  actorLabel: number
  actorSubLabel: number
  bubbleBg: number
  bubbleText: number
  /** Emoji del avatar: el relleno hace de contorno cuando el fondo es claro. */
  faceFill: number
  /**
   * Multiplicador de opacidad de los trazos grabados (caballeros y escudos). Los mismos
   * valores que quedan sutiles sobre negro desaparecen sobre blanco.
   */
  inkBoost: number
}

const DARK: Palette = {
  bg: 0x0b0d12,
  plate: 0x11141b,
  plateBorder: 0x232936,
  plateLabel: 0x8b95a8,
  plateDetail: 0x5b6474,
  deskFill: 0x7dd3fc,
  deskFillAlpha: 0.016,
  deskLine: 0x1c2230,
  deskLineSoft: 0x1a2030,
  motto: 0x2b3448,
  ink: 0x7dd3fc,
  inkAlpha: 0.05,
  knight: 0xb8c9e2,
  knightHot: 0xf2f6ff,
  crest: 0xc3d3ea,
  crestHot: 0xffe6a3,
  actorBody: 0x171b24,
  actorLabel: 0x8b95a8,
  actorSubLabel: 0x6b7688,
  bubbleBg: 0x0b0d12,
  bubbleText: 0xdde3ee,
  faceFill: 0xffffff,
  inkBoost: 1,
}

/**
 * En claro no vale con invertir: sobre fondo blanco los mismos trazos desaparecen, así que
 * los grises se oscurecen y las alfas de la Mesa suben para que el grabado siga leyéndose.
 */
const LIGHT: Palette = {
  bg: 0xf4f6fa,
  plate: 0xffffff,
  plateBorder: 0xd3dae6,
  plateLabel: 0x53607a,
  plateDetail: 0x7d879b,
  deskFill: 0x2f6f9e,
  deskFillAlpha: 0.03,
  deskLine: 0xc2ccdc,
  deskLineSoft: 0xcdd6e3,
  motto: 0xb4c0d3,
  ink: 0x2f6f9e,
  inkAlpha: 0.09,
  knight: 0x6f7f99,
  knightHot: 0x25405f,
  crest: 0x74849c,
  crestHot: 0xa06a12,
  actorBody: 0xffffff,
  actorLabel: 0x53607a,
  actorSubLabel: 0x7d879b,
  bubbleBg: 0xffffff,
  bubbleText: 0x1d2430,
  faceFill: 0xffffff,
  inkBoost: 1.7,
}

export function palette(): Palette {
  return theme.value === 'light' ? LIGHT : DARK
}

/**
 * Ajusta un color de estado o de tipo de agente al tema. Los tonos son los mismos en los dos
 * temas a propósito (verde = trabajando, azul = Explore); sobre fondo claro simplemente se
 * oscurecen, porque un celeste claro sobre blanco no se ve.
 */
export function inkFor(color: number): number {
  if (theme.value !== 'light') return color
  const channels = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
  // Se oscurece más cuanto más claro es el tono de partida: un 38 % le sienta bien a los
  // colores medios, pero el gris casi blanco de Claude quedaría ilegible sobre fondo claro.
  const luma = (0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!) / 255
  const factor = 0.62 - 0.4 * Math.max(0, Math.min(1, (luma - 0.7) / 0.3))
  const darker = channels.map((value) => Math.round(value * factor))
  return (darker[0]! << 16) | (darker[1]! << 8) | darker[2]!
}
