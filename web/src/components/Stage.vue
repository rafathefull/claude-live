<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isReplaying, onEvent, selectedSession, state } from '../store'
import { Scene, type HoverInfo } from '../world/Scene'
import JobsBanner from './JobsBanner.vue'
import { Director } from '../world/director'
import type { TimelineEvent } from '@shared/types'
import { lang, tr } from '../i18n'
import { theme } from '../theme'

const L = {
  loading: { es: 'Cargando la sesión…', en: 'Loading the session…' },
  noSession: { es: 'No hay ninguna sesión de Claude abierta.', en: 'No Claude session is open.' },
  hint: {
    es: 'Abre claude en cualquier directorio y aparecerá aquí sola: no hay que configurar nada en el proyecto.',
    en: 'Run claude in any directory and it will show up on its own: nothing to configure in the project.',
  },
}

const host = ref<HTMLElement | null>(null)
/** Ayuda contextual del elemento bajo el cursor, para no tener que abrir la leyenda. */
const hover = ref<HoverInfo | null>(null)
const hoverPos = ref({ x: 0, y: 0 })
/** Banner del Campamento: se despliega al pulsar su cartel. */
const campOpen = ref(false)
let scene: Scene | null = null
let director: Director | null = null
let unsubscribe: (() => void) | null = null
/** Pixi solo escucha el `resize` de la ventana; el divisor cambia el hueco sin tocarla. */
let fitter: ResizeObserver | null = null

function labelFor(): string {
  const session = selectedSession.value
  if (!session) return 'Claude'
  return session.project || 'Claude'
}

function feed(event: TimelineEvent): void {
  if (!director) return
  if (event.sessionId !== state.selectedSessionId) return
  if (!state.showThinking && event.kind === 'thinking') return
  director.handle(event)
}

/** Monta la escena. Se rehace al cambiar de idioma: los rótulos viven dentro del canvas. */
async function mountWorld(): Promise<void> {
  if (!host.value) return
  scene = new Scene()
  await scene.mount(host.value)
  director = new Director(scene)
  director.bootstrap(labelFor())
  scene.app.ticker.add(() => director?.tick(performance.now()))
  scene.setHoverHandler((info, x, y) => {
    hover.value = info
    if (info) hoverPos.value = { x, y }
  })
  scene.setStationClickHandler((station) => {
    if (station === 'camp') campOpen.value = !campOpen.value
  })
  unsubscribe = onEvent(feed)
  scene.syncJobs(state.jobs)
  fitter = new ResizeObserver(() => scene?.app.queueResize())
  fitter.observe(host.value)
  primeWorld()
}

function unmountWorld(): void {
  unsubscribe?.()
  unsubscribe = null
  fitter?.disconnect()
  fitter = null
  scene?.destroy()
  scene = null
  director = null
}

onMounted(mountWorld)

// El mundo se reconstruye al cambiar de idioma o de tema: los nombres de las estaciones y el
// grabado de la mesa son texto y trazos dibujados en el canvas, con sus colores ya aplicados.
watch([lang, theme], async () => {
  hover.value = null
  unmountWorld()
  await mountWorld()
})

/**
 * Puebla el mundo al montar, al cambiar de sesión o tras un salto del reproductor.
 * En directo se muestran los últimos eventos (lo que importa es el ahora); en replay se
 * reconstruye solo el contexto inmediato anterior al punto actual, porque de ahí en
 * adelante los eventos los va soltando el motor del reproductor.
 */
function primeWorld(): void {
  if (!director) return
  director.reset(labelFor())
  const sessionId = state.selectedSessionId
  if (!sessionId) return
  const events = state.events[sessionId] ?? []
  const slice = isReplaying.value
    ? events.slice(Math.max(0, state.replay.index - 6), state.replay.index)
    : events.slice(-25)
  for (const event of slice) feed(event)
}

// Los jobs se sincronizan aparte de los eventos: no vienen de la timeline de ninguna sesión.
watch(
  () => state.jobs,
  (jobs) => scene?.syncJobs(jobs),
  { deep: true, immediate: true },
)

watch(() => state.selectedSessionId, primeWorld)
watch(() => state.replay.seekToken, primeWorld)

watch(
  () => selectedSession.value?.project,
  () => director?.setMainLabel(labelFor()),
)

const TIP_W = 290
const TIP_H = 150

const tooltipStyle = computed(() => {
  const width = host.value?.clientWidth ?? 0
  const height = host.value?.clientHeight ?? 0
  const x = Math.min(hoverPos.value.x + 18, Math.max(8, width - TIP_W))
  const y = Math.min(hoverPos.value.y + 16, Math.max(8, height - TIP_H))
  return { left: `${x}px`, top: `${y}px` }
})

onBeforeUnmount(unmountWorld)
</script>

<template>
  <div class="stage" ref="host">
    <div v-if="state.loadingSession" class="stage-empty">
      <p>{{ tr(L.loading) }}</p>
    </div>
    <div v-else-if="!state.selectedSessionId" class="stage-empty">
      <div>
        <p>{{ tr(L.noSession) }}</p>
        <p class="muted">{{ tr(L.hint) }}</p>
      </div>
    </div>
    <aside v-if="hover" class="world-tip" :style="tooltipStyle">
      <header>
        <span class="tip-icon">{{ hover.icon }}</span>
        <strong :style="hover.color ? { color: hover.color } : undefined">{{ hover.title }}</strong>
      </header>
      <p>{{ hover.body }}</p>
      <p v-if="hover.extra" class="tip-extra">{{ hover.extra }}</p>
    </aside>

    <JobsBanner v-if="campOpen" @close="campOpen = false" />

    <slot />
  </div>
</template>
