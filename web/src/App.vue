<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Hud from './components/Hud.vue'
import Stage from './components/Stage.vue'
import Timeline from './components/Timeline.vue'
import Inspector from './components/Inspector.vue'
import HistoryView from './components/HistoryView.vue'
import Neighborhood from './components/Neighborhood.vue'
import MetricsView from './components/MetricsView.vue'
import DemoNotice from './components/DemoNotice.vue'
import Tour from './components/Tour.vue'
import Legend from './components/Legend.vue'
import ReplayBar from './components/ReplayBar.vue'
import {
  SPEEDS,
  isReplaying,
  seekTo,
  setSpeed,
  state,
  step,
  togglePlay,
} from './store'
import { STATIC_MODE } from './backend'
import { clampTimelineWidth, loadTimelineWidth, saveTimelineWidth } from './split'
import { actionForKey, isTypingTarget, nextSpeed } from './shortcuts'
import { tr } from './i18n'

const L = {
  drag: {
    es: 'Arrastra para ajustar el ancho de la timeline · doble clic para restablecer',
    en: 'Drag to resize the timeline · double-click to reset',
  },
}

const view = ref<'live' | 'history' | 'hood' | 'metrics'>('live')

/**
 * Recorrido guiado, solo en la demostración publicada: arranca solo la primera visita —con un
 * retardo, para que el mundo ya tenga algo que enseñar— y se puede relanzar desde la cabecera.
 */
const tourOpen = ref(false)
if (STATIC_MODE && localStorage.getItem('claude-live:tour-seen') !== '1') {
  setTimeout(() => (tourOpen.value = true), 3500)
}

/** `null` = ancho por omisión, el que decide el CSS según el tamaño de ventana. */
const timelineWidth = ref<number | null>(loadTimelineWidth())
const dragging = ref(false)
const body = ref<HTMLElement | null>(null)

const bodyStyle = computed(() =>
  timelineWidth.value === null ? undefined : { '--timeline-w': `${timelineWidth.value}px` },
)

function startDrag(event: PointerEvent): void {
  const host = body.value
  if (!host) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragging.value = true
  event.preventDefault()

  const move = (e: PointerEvent) => {
    const rect = host.getBoundingClientRect()
    timelineWidth.value = clampTimelineWidth(rect.right - e.clientX, rect.width, target.offsetWidth)
  }
  const end = () => {
    dragging.value = false
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', end)
    target.removeEventListener('pointercancel', end)
    saveTimelineWidth(timelineWidth.value)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', end)
  target.addEventListener('pointercancel', end)
}

/** Doble clic: se olvida la preferencia y vuelve a mandar el ancho por omisión. */
function resetDrag(): void {
  timelineWidth.value = null
  saveTimelineWidth(null)
}

/**
 * Atajos del reproductor. Van en el documento y no en la barra porque la barra no tiene el
 * foco: se pulsa espacio mirando el mundo, no el botón.
 */
function onKeydown(event: KeyboardEvent): void {
  if (!isReplaying.value || isTypingTarget(event.target)) return
  const action = actionForKey(event)
  if (!action) return
  event.preventDefault()

  switch (action.kind) {
    case 'toggle':
      togglePlay()
      break
    case 'step':
      step(action.delta)
      break
    case 'seekStart':
      seekTo(0)
      break
    case 'seekEnd':
      seekTo(state.replay.total + state.replay.pending)
      break
    case 'speed':
      setSpeed(nextSpeed(state.replay.speed, action.direction, SPEEDS))
      break
  }
}

// Al estrechar la ventana hay que reajustar: un ancho guardado en una pantalla grande
// dejaría el escenario en nada al abrir la app en un portátil.
let observer: ResizeObserver | null = null
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  observer = new ResizeObserver(() => {
    if (timelineWidth.value === null || !body.value) return
    const splitter = body.value.querySelector('.splitter') as HTMLElement | null
    timelineWidth.value = clampTimelineWidth(
      timelineWidth.value,
      body.value.clientWidth,
      splitter?.offsetWidth ?? 0,
    )
  })
  if (body.value) observer.observe(body.value)
})

// El cuerpo se destruye al irse al histórico y vuelve a crearse al volver: hay que
// reengancharse al elemento nuevo o el reajuste se queda mudo.
watch(body, (el) => {
  observer?.disconnect()
  if (el) observer?.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app" :class="{ dragging }">
    <Hud
      :view="view"
      :tour="STATIC_MODE"
      @view="view = $event"
      @legend="state.legendOpen = true"
      @tour="tourOpen = true"
    />

    <DemoNotice v-if="STATIC_MODE" @tour="tourOpen = true" />

    <Tour v-if="tourOpen" :view="view" @view="view = $event" @close="tourOpen = false" />

    <ReplayBar v-if="isReplaying && view === 'live'" />

    <HistoryView v-if="view === 'history'" @open="view = 'live'" />

    <Neighborhood v-else-if="view === 'hood'" @enter="view = 'live'" />

    <MetricsView v-else-if="view === 'metrics'" />

    <div v-else ref="body" class="body" :class="{ sober: state.soberMode }" :style="bodyStyle">
      <Stage v-if="!state.soberMode">
        <Inspector />
      </Stage>
      <div
        v-if="!state.soberMode"
        class="splitter"
        role="separator"
        aria-orientation="vertical"
        :title="tr(L.drag)"
        @pointerdown="startDrag"
        @dblclick="resetDrag"
      />
      <Timeline />
    </div>

    <Legend v-if="state.legendOpen" @close="state.legendOpen = false" />
  </div>
</template>
