<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { STATIONS, toolsForStation } from '@shared/mapping'
import { MOOD_EMOJI, MOOD_RING } from '../world/Actor'
import type { ActorMood } from '../world/Actor'
import { agentColorCss } from '../format'

const emit = defineEmits<{ (e: 'close'): void }>()

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

/** Los tipos de subagente que Claude Code trae de serie, más el caso genérico. */
const AGENT_TYPES: { type: string | undefined; what: string }[] = [
  { type: 'Explore', what: 'Rastrea el código en paralelo y devuelve dónde está cada cosa.' },
  { type: 'Plan', what: 'Diseña la implementación antes de tocar nada.' },
  { type: 'general-purpose', what: 'Tareas variadas de varios pasos.' },
  { type: 'claude-code-guide', what: 'Dudas sobre Claude Code, su SDK y su API.' },
  { type: 'otro', what: 'Cualquier subagente propio que definas en .claude/agents.' },
]

/** `short` para la tarjeta de Claude, `what` para la sección de estados. */
const MOODS: { mood: ActorMood; label: string; short: string; what: string }[] = [
  {
    mood: 'thinking',
    label: 'azul',
    short: 'pensando',
    what: 'Está razonando: el texto de la burbuja es su pensamiento real.',
  },
  {
    mood: 'working',
    label: 'verde',
    short: 'trabajando en una estación',
    what: 'Ha ido a una estación a ejecutar una herramienta.',
  },
  {
    mood: 'talking',
    label: 'morado',
    short: 'escribiendo su respuesta',
    what: 'Está escribiendo su respuesta visible.',
  },
  {
    mood: 'waiting',
    label: 'ámbar',
    short: 'error o esperándote a ti',
    what: 'Error en una herramienta o permiso pendiente de que tú decidas.',
  },
  {
    mood: 'idle',
    label: 'gris, sin latido',
    short: 'quieto, turno terminado',
    what: 'Sin nada en marcha; el turno ha terminado.',
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
        <strong>Leyenda</strong>
        <span class="muted">qué es cada cosa del mundo</span>
        <button style="margin-left: auto" @click="emit('close')">✕</button>
      </header>

      <div class="legend-body">
        <h3>Lugares</h3>
        <p class="muted legend-note">
          Cada herramienta que usa Claude tiene un sitio en el escenario. El actor camina hasta
          allí, la estación destella y su contador «×n» sube. La <strong>Mesa</strong> es la
          excepción: no es una herramienta, sino la zona central —la alfombra tenue— por donde
          se mueven los actores.
        </p>
        <div class="legend-grid">
          <article v-for="station in STATIONS" :key="station.id">
            <div class="legend-title">
              <span class="legend-icon">{{ station.icon }}</span>
              <strong>{{ station.label }}</strong>
            </div>
            <p>{{ station.help }}</p>
            <p v-if="toolsForStation(station.id).length" class="tools">
              {{ toolsForStation(station.id).join(' · ') }}
            </p>
          </article>
        </div>

        <h3>Habitantes</h3>
        <div class="legend-grid">
          <article>
            <div class="legend-title">
              <span class="legend-icon">🧑</span>
              <strong>Tú</strong>
            </div>
            <p>Abajo en el centro. Cuando escribes un prompt aparece en su burbuja y sale una
              línea hacia Claude.</p>
          </article>
          <article>
            <div class="legend-title">
              <span class="legend-icon">🤖</span>
              <strong>Claude</strong>
            </div>
            <p>El agente principal de la sesión. Es el único que puede lanzar subagentes. El
              <strong>anillo que lo rodea late cuando está activo</strong>, y su color dice qué
              está haciendo:</p>
            <ul class="moods">
              <li v-for="entry in MOODS" :key="`claude-${entry.mood}`">
                <i class="ring" :style="{ borderColor: hex(MOOD_RING[entry.mood]) }" />
                <span class="mood-badge">{{ MOOD_EMOJI[entry.mood] || '—' }}</span>
                <span><strong>{{ entry.label }}</strong> — {{ entry.short }}</span>
              </li>
            </ul>
            <p class="muted legend-note" style="margin-top: 8px">
              Los subagentes usan los mismos colores de anillo; su círculo, en cambio, lleva el
              color de su tipo.
            </p>
          </article>
          <article>
            <div class="legend-title">
              <span class="legend-icon">👤</span>
              <strong>Subagentes</strong>
            </div>
            <p>Nacen junto a Claude cuando él los lanza, trabajan por su cuenta y al terminar
              le entregan su informe (línea verde) antes de desaparecer. Bajo cada uno se lee
              <strong>su cometido</strong>, y si hay varios del mismo tipo cada uno recibe un
              matiz distinto del color y se numeran en la timeline («Explore 1», «Explore 2»),
              para poder seguirlos por separado. El color base indica el tipo:</p>
            <ul class="agent-types">
              <li v-for="entry in AGENT_TYPES" :key="entry.type ?? 'x'">
                <i class="swatch" :style="{ background: agentColorCss(entry.type) }" />
                <span><strong>{{ entry.type }}</strong> — {{ entry.what }}</span>
              </li>
            </ul>
          </article>
        </div>

        <h3>Estados: el anillo de Claude y de los subagentes</h3>
        <p class="muted legend-note">
          El aro que rodea a cada actor <strong>late mientras está activo</strong> y se apaga
          cuando no hace nada. Además, una <strong>insignia</strong> sobre el avatar repite el
          estado en forma de icono, para no depender solo del color.
        </p>
        <ul class="moods">
          <li v-for="entry in MOODS" :key="entry.mood">
            <i class="ring" :style="{ borderColor: hex(MOOD_RING[entry.mood]) }" />
            <span class="mood-badge">{{ MOOD_EMOJI[entry.mood] || '—' }}</span>
            <span><strong>{{ entry.label }}</strong> ({{ entry.short }}) — {{ entry.what }}</span>
          </li>
        </ul>

        <h3>Cómo leer el ritmo</h3>
        <ul class="moods">
          <li>
            <span><strong>«×7» junto a una herramienta</strong> — siete llamadas seguidas al
              mismo sitio se agrupan en una sola acción para que la escena siga siendo
              legible.</span>
          </li>
          <li>
            <span><strong>Los actores aceleran</strong> cuando hay cola: el mundo comprime las
              animaciones en las ráfagas, pero la timeline de la derecha nunca pierde un
              evento.</span>
          </li>
          <li>
            <span><strong>Pasa el ratón</strong> por cualquier estación o actor del escenario y
              sale su explicación al momento, sin abrir esta leyenda.</span>
          </li>
          <li>
            <span><strong>Modo sobrio</strong> — el botón de arriba apaga la escena y deja solo
              la timeline, para cuando quieras leer en vez de mirar.</span>
          </li>
          <li>
            <span><strong>Reproductor</strong> — al abrir una conversación del historial aparece
              una barra con ⏮ ⏪ ⏵ ⏩ ⏭, velocidades de 0,5× a 16× y una barra para saltar a
              cualquier punto. El ritmo respeta los tiempos reales de la conversación, acotados
              para que los huecos largos no la congelen.</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
