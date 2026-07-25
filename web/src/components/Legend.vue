<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { STATIONS, toolsForStation } from '@shared/mapping'
import { MOOD_EMOJI, MOOD_RING } from '../world/Actor'
import type { ActorMood } from '../world/Actor'
import { agentColorCss } from '../format'
import { tr } from '../i18n'

const L = {
  legend: { es: 'Leyenda', en: 'Legend' },
  subtitle: { es: 'qué es cada cosa del mundo', en: 'what everything in the world means' },
  places: { es: 'Lugares', en: 'Places' },
  placesNote: {
    es: 'Cada herramienta que usa Claude tiene un sitio en el escenario. El actor camina hasta allí, la estación destella y su contador «×n» sube. La Mesa es la excepción: no es una herramienta, sino la zona central —la alfombra tenue— por donde se mueven los actores.',
    en: 'Every tool Claude uses has a place on the stage. The actor walks there, the station flashes and its «×n» counter goes up. The table is the exception: not a tool, but the central area the actors move across.',
  },
  dwellers: { es: 'Habitantes', en: 'Dwellers' },
  you: { es: 'Tú', en: 'You' },
  youWhat: {
    es: 'Abajo en el centro. Cuando escribes un prompt aparece en su burbuja y sale una línea hacia Claude.',
    en: 'Bottom centre. When you send a prompt it shows in the speech bubble and a line reaches out to Claude.',
  },
  claudeWhat: {
    es: 'El agente principal de la sesión. Es el único que puede lanzar subagentes. El anillo que lo rodea late cuando está activo, y su color dice qué está haciendo:',
    en: 'The session\'s main agent, and the only one that can launch subagents. The ring around it beats while it is busy, and its colour says what it is doing:',
  },
  claudeNote: {
    es: 'Los subagentes usan los mismos colores de anillo; su círculo, en cambio, lleva el color de su tipo.',
    en: 'Subagents use the same ring colours; their body, however, carries the colour of their type.',
  },
  subagents: { es: 'Subagentes', en: 'Subagents' },
  subagentsWhat: {
    es: 'Nacen en semicírculo delante de Claude y esperan ahí, en la Mesa, hasta que su primera herramienta los manda a una estación: si ves uno quieto en el centro, es que acaba de arrancar. Trabajan por su cuenta y al terminar le entregan su informe (línea verde) antes de desaparecer. Bajo cada uno se lee su cometido, y si hay varios del mismo tipo cada uno recibe un matiz distinto del color y se numeran («Explore 1», «Explore 2»). El color base indica el tipo:',
    en: 'They are born in a half circle in front of Claude and wait there, at the table, until their first tool sends them to a station: one standing still in the middle has just started. They work on their own and hand in their report (green line) before vanishing. Each one shows its task underneath, and when several share a type each gets a different shade and a number («Explore 1», «Explore 2»). The base colour is the type:',
  },
  states: {
    es: 'Estados: el anillo de Claude y de los subagentes',
    en: 'States: the ring around Claude and the subagents',
  },
  statesNote: {
    es: 'El aro que rodea a cada actor late mientras está activo y se apaga cuando no hace nada. Además, una insignia sobre el avatar repite el estado en forma de icono, para no depender solo del color.',
    en: 'The ring around each actor beats while it is busy and goes quiet when it is not. A badge over the avatar repeats the state as an icon, so it never depends on colour alone.',
  },
  rhythm: { es: 'Cómo leer el ritmo', en: 'Reading the pace' },
  merge: {
    es: '«×7» junto a una herramienta — siete llamadas seguidas al mismo sitio se agrupan en una sola acción para que la escena siga siendo legible.',
    en: '«×7» next to a tool — seven calls in a row to the same place are merged into one action so the scene stays readable.',
  },
  speedUp: {
    es: 'Los actores aceleran cuando hay cola: el mundo comprime las animaciones en las ráfagas, pero la timeline de la derecha nunca pierde un evento.',
    en: 'Actors speed up when the queue grows: the world compresses animations during bursts, but the timeline on the right never drops an event.',
  },
  hoverTip: {
    es: 'Pasa el ratón por cualquier estación o actor del escenario y sale su explicación al momento, sin abrir esta leyenda.',
    en: 'Hover any station or actor on the stage and its explanation shows up right away, without opening this legend.',
  },
  jokes: {
    es: 'Alguna cosa no se toma muy en serio. La mesa central está grabada, el Trastero cría fauna si se llena y a un actor que le falla una herramienta se le escapa alguna queja del Caballero Negro. El error se sigue contando igual, tanto en el mundo como en la timeline.',
    en: 'A few things are not entirely serious. The central table is engraved, the junk room grows wildlife if it fills up, and an actor whose tool fails lets slip a line from the Black Knight. The error is still reported in full, both in the world and in the timeline.',
  },
  soberTip: {
    es: 'Modo sobrio — el botón de arriba apaga la escena y deja solo la timeline, para cuando quieras leer en vez de mirar.',
    en: 'Plain mode — the button above turns off the stage and leaves only the timeline, for when you would rather read than watch.',
  },
  playerTip: {
    es: 'Reproductor — al abrir una conversación del historial aparece una barra con ⏮ ⏪ ⏵ ⏩ ⏭, velocidades de 0,5× a 16× y una barra para saltar a cualquier punto. El ritmo respeta los tiempos reales de la conversación, acotados para que los huecos largos no la congelen.',
    en: 'Player — opening a conversation from the history brings up a bar with ⏮ ⏪ ⏵ ⏩ ⏭, speeds from 0.5× to 16× and a slider to jump anywhere. The pace follows the real timings of the conversation, capped so long gaps do not freeze it.',
  },
}

const emit = defineEmits<{ (e: 'close'): void }>()

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

/** Los tipos de subagente que Claude Code trae de serie, más el caso genérico. */
const AGENT_TYPES: { type: string | undefined; what: { es: string; en: string } }[] = [
  { type: 'Explore', what: { es: 'Rastrea el código en paralelo y devuelve dónde está cada cosa.', en: 'Sweeps the codebase in parallel and reports where everything is.' } },
  { type: 'Plan', what: { es: 'Diseña la implementación antes de tocar nada.', en: 'Designs the implementation before touching anything.' } },
  { type: 'general-purpose', what: { es: 'Tareas variadas de varios pasos.', en: 'Assorted multi-step tasks.' } },
  { type: 'claude-code-guide', what: { es: 'Dudas sobre Claude Code, su SDK y su API.', en: 'Questions about Claude Code, its SDK and its API.' } },
  { type: 'otro', what: { es: 'Cualquier subagente propio que definas en .claude/agents.', en: 'Any custom subagent you define in .claude/agents.' } },
]

/** `short` para la tarjeta de Claude, `what` para la sección de estados. */
type Bi = { es: string; en: string }
const MOODS: { mood: ActorMood; label: Bi; short: Bi; what: Bi }[] = [
  {
    mood: 'thinking',
    label: { es: 'azul', en: 'blue' },
    short: { es: 'pensando', en: 'thinking' },
    what: { es: 'Está razonando: el texto de la burbuja es su pensamiento real.', en: 'It is reasoning: the bubble shows its actual thinking.' },
  },
  {
    mood: 'working',
    label: { es: 'verde', en: 'green' },
    short: { es: 'trabajando en una estación', en: 'working at a station' },
    what: { es: 'Ha ido a una estación a ejecutar una herramienta.', en: 'It walked to a station to run a tool.' },
  },
  {
    mood: 'talking',
    label: { es: 'morado', en: 'purple' },
    short: { es: 'escribiendo su respuesta', en: 'writing its answer' },
    what: { es: 'Está escribiendo su respuesta visible.', en: 'It is writing the answer you will read.' },
  },
  {
    mood: 'waiting',
    label: { es: 'ámbar', en: 'amber' },
    short: { es: 'error o esperándote a ti', en: 'error, or waiting on you' },
    what: { es: 'Error en una herramienta o permiso pendiente de que tú decidas.', en: 'A tool failed, or a permission is waiting for your call.' },
  },
  {
    mood: 'idle',
    label: { es: 'gris, sin latido', en: 'grey, no beat' },
    short: { es: 'quieto, turno terminado', en: 'idle, turn finished' },
    what: { es: 'Sin nada en marcha; el turno ha terminado.', en: 'Nothing in flight; the turn is over.' },
  },
]

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="legend-backdrop" @click.self="emit('close')">
    <section class="legend" role="dialog" aria-label="Leyenda del mundo">
      <header>
        <strong>{{ tr(L.legend) }}</strong>
        <span class="muted">{{ tr(L.subtitle) }}</span>
        <button style="margin-left: auto" @click="emit('close')">✕</button>
      </header>

      <div class="legend-body">
        <h3>{{ tr(L.places) }}</h3>
        <p class="muted legend-note">{{ tr(L.placesNote) }}</p>
        <div class="legend-grid">
          <article v-for="station in STATIONS" :key="station.id">
            <div class="legend-title">
              <span class="legend-icon">{{ station.icon }}</span>
              <strong>{{ tr(station.label) }}</strong>
            </div>
            <p>{{ tr(station.help) }}</p>
            <p v-if="toolsForStation(station.id).length" class="tools">
              {{ toolsForStation(station.id).join(' · ') }}
            </p>
          </article>
        </div>

        <h3>{{ tr(L.dwellers) }}</h3>
        <div class="legend-grid">
          <article>
            <div class="legend-title">
              <span class="legend-icon">🧑</span>
              <strong>{{ tr(L.you) }}</strong>
            </div>
            <p>{{ tr(L.youWhat) }}</p>
          </article>
          <article>
            <div class="legend-title">
              <span class="legend-icon">🤖</span>
              <strong>Claude</strong>
            </div>
            <p>{{ tr(L.claudeWhat) }}</p>
            <ul class="moods">
              <li v-for="entry in MOODS" :key="`claude-${entry.mood}`">
                <i class="ring" :style="{ borderColor: hex(MOOD_RING[entry.mood]) }" />
                <span class="mood-badge">{{ MOOD_EMOJI[entry.mood] || '—' }}</span>
                <span><strong>{{ tr(entry.label) }}</strong> — {{ tr(entry.short) }}</span>
              </li>
            </ul>
            <p class="muted legend-note" style="margin-top: 8px">{{ tr(L.claudeNote) }}</p>
          </article>
          <article>
            <div class="legend-title">
              <span class="legend-icon">👤</span>
              <strong>{{ tr(L.subagents) }}</strong>
            </div>
            <p>{{ tr(L.subagentsWhat) }}</p>
            <ul class="agent-types">
              <li v-for="entry in AGENT_TYPES" :key="entry.type ?? 'x'">
                <i class="swatch" :style="{ background: agentColorCss(entry.type) }" />
                <span><strong>{{ entry.type }}</strong> — {{ tr(entry.what) }}</span>
              </li>
            </ul>
          </article>
        </div>

        <h3>{{ tr(L.states) }}</h3>
        <p class="muted legend-note">{{ tr(L.statesNote) }}</p>
        <ul class="moods">
          <li v-for="entry in MOODS" :key="entry.mood">
            <i class="ring" :style="{ borderColor: hex(MOOD_RING[entry.mood]) }" />
            <span class="mood-badge">{{ MOOD_EMOJI[entry.mood] || '—' }}</span>
            <span><strong>{{ tr(entry.label) }}</strong> ({{ tr(entry.short) }}) — {{ tr(entry.what) }}</span>
          </li>
        </ul>

        <h3>{{ tr(L.rhythm) }}</h3>
        <ul class="moods">
          <li><span>{{ tr(L.merge) }}</span></li>
          <li><span>{{ tr(L.speedUp) }}</span></li>
          <li><span>{{ tr(L.hoverTip) }}</span></li>
          <li><span>{{ tr(L.jokes) }}</span></li>
          <li><span>{{ tr(L.soberTip) }}</span></li>
          <li><span>{{ tr(L.playerTip) }}</span></li>
        </ul>
      </div>
    </section>
  </div>
</template>
