import type { Text } from '@shared/i18n'

/**
 * Tour guiado de la demostración: bocadillos anclados a cada sitio, en orden, explicando qué es
 * y qué está pasando ahí.
 *
 * Solo aparece en la versión publicada. En tu propio visor sería un estorbo —ya sabes lo que
 * miras—, pero quien llega a la web de nuevas necesita que alguien le diga qué son esas cajas y
 * ese robot.
 *
 * Los pasos viven aquí y no dentro del componente para poder comprobarlos sin navegador: que
 * todos tengan sus dos idiomas y que las anclas apunten a algo que existe de verdad.
 */

export type TourView = 'live' | 'history' | 'hood' | 'metrics'

export type TourAnchor =
  /** Un punto del escenario, en fracciones del lienzo (las mismas que usa el mundo). */
  | { kind: 'canvas'; x: number; y: number; r?: number }
  /** Un elemento de la interfaz. */
  | { kind: 'css'; selector: string }
  /** Sin ancla: el bocadillo va centrado, para la bienvenida y la despedida. */
  | { kind: 'center' }

export interface TourStep {
  id: string
  /** Pestaña en la que se ve este paso; el tour la abre solo. */
  view: TourView
  anchor: TourAnchor
  title: Text
  body: Text
}

export const TOUR: TourStep[] = [
  {
    id: 'welcome',
    view: 'live',
    anchor: { kind: 'center' },
    title: { es: 'Esto es lo que hace Claude Code por debajo', en: 'This is Claude Code from below' },
    body: {
      es: 'Cada cosa que hace Claude —leer un fichero, lanzar un test, pedirte permiso— pasa aquí delante en forma de mundo. A la derecha, la misma historia en texto. Este recorrido son nueve paradas; puedes seguir tocando todo mientras lo lees.',
      en: 'Everything Claude does —read a file, run a test, ask your permission— happens here as a world. On the right, the same story in text. This tour is nine stops; you can keep poking around while you read.',
    },
  },
  {
    id: 'actors',
    view: 'live',
    anchor: { kind: 'canvas', x: 0.5, y: 0.88, r: 60 },
    title: { es: 'Tú, y Claude', en: 'You, and Claude' },
    body: {
      es: 'Abajo estás tú: cuando escribes algo, aparece en tu bocadillo. El robot es Claude, y no se queda quieto: camina hasta la herramienta que va a usar. Su anillo dice en qué anda —azul pensando, verde trabajando, ámbar esperándote— y la insignia lo repite en icono, para no depender del color.',
      en: 'You are at the bottom: whatever you type shows up in your bubble. The robot is Claude, and it does not sit still: it walks to the tool it is about to use. Its ring says what it is up to —blue thinking, green working, amber waiting on you— and the badge repeats it as an icon, so it never depends on colour alone.',
    },
  },
  {
    id: 'stations',
    view: 'live',
    anchor: { kind: 'canvas', x: 0.13, y: 0.18, r: 76 },
    title: { es: 'Cada herramienta tiene su sitio', en: 'Every tool has its place' },
    body: {
      es: 'La Biblioteca es leer y buscar; el Terminal, la shell; el Taller, escribir ficheros. El «×12» de la esquina son las veces que se ha usado en esta sesión, y encima del cartel sale lo último que pasó allí. El Trastero (❓) recoge lo que aún no tiene sitio propio: si se llena, cría un conejo.',
      en: 'The Library is reading and searching; the Terminal is the shell; the Workshop is writing files. The «×12» in the corner counts the visits in this session, and above the sign you get the last thing that happened there. The Junk Room (❓) collects whatever has no place of its own yet: fill it up and it grows a rabbit.',
    },
  },
  {
    id: 'subagents',
    view: 'live',
    anchor: { kind: 'canvas', x: 0.13, y: 0.42, r: 90 },
    title: { es: 'Los subagentes nacen y mueren', en: 'Subagents are born and die' },
    body: {
      es: 'Cuando Claude delega, nace otro avatar con su tipo (Explore, Plan, general-purpose…), su color y, debajo, el cometido con el que se lanzó. Dos Explore a la vez llevan tonos distintos para poder seguirlos. Al terminar entregan su informe y se desvanecen.',
      en: 'When Claude delegates, another avatar is born with its type (Explore, Plan, general-purpose…), its colour and, underneath, the task it was launched with. Two Explores at once get different shades so you can tell them apart. When they finish they hand in their report and fade away.',
    },
  },
  {
    id: 'desk',
    view: 'live',
    anchor: { kind: 'canvas', x: 0.5, y: 0.52, r: 130 },
    title: { es: 'La mesa cuadrada', en: 'The square table' },
    body: {
      es: 'La zona central por la que se mueven los actores. Está grabada con doce caballeros y su lema, en homenaje a Monty Python: pasa el ratón por un asiento y se presenta. No es una herramienta, es el sitio donde se espera.',
      en: 'The central area the actors move across. It is engraved with twelve knights and their motto, in homage to Monty Python: hover a seat and it introduces itself. It is not a tool, it is where you wait.',
    },
  },
  {
    id: 'camp',
    view: 'live',
    anchor: { kind: 'canvas', x: 0.09, y: 0.79, r: 70 },
    title: { es: 'El Campamento: lo que sigue solo', en: 'The Camp: work that carries on' },
    body: {
      es: 'Los jobs que lanzaste con /bg y siguen por su cuenta, incluso los que ya acabaron. Pulsa el cartel y se despliega la lista con el estado de cada uno y su último parte; pulsando uno se abre su conversación. Un job que dice estar trabajando sin proceso detrás sale como residuo (💤), porque decir que trabaja sería mentir.',
      en: 'Jobs you launched with /bg that carry on by themselves, including the finished ones. Click the sign and the list unfolds with each state and its last report; click one and its conversation opens. A job claiming to work with no process behind it shows up as stale (💤), because saying it works would be a lie.',
    },
  },
  {
    id: 'timeline',
    view: 'live',
    anchor: { kind: 'css', selector: '.timeline' },
    title: { es: 'La timeline no se pierde nada', en: 'The timeline drops nothing' },
    body: {
      es: 'El mundo agrupa y acelera cuando hay ráfagas, pero aquí está todo, con su hora, su duración y sus errores. Pulsa una línea y abajo sale la caja con el detalle completo. Las píldoras de abajo filtran por actor, y el divisor de la izquierda se arrastra para darle más ancho.',
      en: 'The world merges and speeds up during bursts, but everything is here, with its time, duration and errors. Click a line and the box with the full detail opens below. The pills at the bottom filter by actor, and the splitter on the left can be dragged to make it wider.',
    },
  },
  {
    id: 'history',
    view: 'history',
    anchor: { kind: 'css', selector: '.history-bar' },
    title: { es: 'El histórico, como una película', en: 'History, like a film' },
    body: {
      es: 'Tus conversaciones pasadas, en tabla o agrupadas por proyecto en árbol. Abre una y el mundo la reproduce con su barra de reproducción: play, saltos, velocidad de 0,5× a 16× y teclado (espacio, flechas, Inicio, Fin). Arriba, el aviso de que Claude Code borra los transcripts pasados 30 días.',
      en: 'Your past conversations, as a table or grouped by project in a tree. Open one and the world plays it back with its player: play, stepping, speeds from 0.5× to 16× and the keyboard (space, arrows, Home, End). At the top, the warning that Claude Code deletes transcripts after 30 days.',
    },
  },
  {
    id: 'hood',
    view: 'hood',
    anchor: { kind: 'css', selector: '.hood-card' },
    title: { es: 'El vecindario', en: 'The neighbourhood' },
    body: {
      es: 'Con varias sesiones abiertas, todas a la vez: cada tarjeta lleva el plano de sus estaciones —se encienden al usarse y llevan su recuento—, lo que está haciendo, sus subagentes y su contexto. Un clic entra en esa habitación.',
      en: 'With several sessions open, all at once: each card carries the plan of its stations —they light up when used and carry their count—, what it is doing, its subagents and its context. One click enters that room.',
    },
  },
  {
    id: 'metrics',
    view: 'metrics',
    anchor: { kind: 'css', selector: '.metrics-totals' },
    title: { es: 'Métricas por proyecto y día', en: 'Metrics per project and day' },
    body: {
      es: 'Cuánto trabajo hay detrás de cada proyecto: sesiones, herramientas, errores, subagentes y tokens, con los días sin actividad dibujados a cero para no mentir. Con una suscripción no se paga por uso, así que no se habla de dinero; quien pague por API pone sus tarifas y aparece el coste.',
      en: 'How much work is behind each project: sessions, tool calls, errors, subagents and tokens, with idle days drawn as zero so the chart does not lie. A subscription does not charge per use, so there is no talk of money; if you pay per API you set your rates and the cost shows up.',
    },
  },
  {
    id: 'end',
    view: 'live',
    anchor: { kind: 'center' },
    title: { es: 'Y esto es una demostración', en: 'And this is a demo' },
    body: {
      es: 'Todo lo que has visto es un mundo inventado que viaja dentro de esta página: aquí no hay servidor. Con tus propias sesiones se engancha solo, sin configurar nada en el proyecto: se arranca en tu máquina y cualquier claude que abras aparece. El enlace al código está arriba.',
      en: 'Everything you have seen is a made-up world travelling inside this page: there is no server here. With your own sessions it attaches on its own, with nothing to set up per project: run it on your machine and any claude you open shows up. The link to the code is at the top.',
    },
  },
]

/** Índice siguiente/anterior, sin salirse. */
export function stepAt(index: number): number {
  return Math.max(0, Math.min(TOUR.length - 1, index))
}
