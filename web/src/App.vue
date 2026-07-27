<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Hud from './components/Hud.vue'
import Stage from './components/Stage.vue'
import Timeline from './components/Timeline.vue'
import Inspector from './components/Inspector.vue'
import HistoryView from './components/HistoryView.vue'
import Legend from './components/Legend.vue'
import ReplayBar from './components/ReplayBar.vue'
import { isReplaying, state } from './store'
import { clampTimelineWidth, loadTimelineWidth, saveTimelineWidth } from './split'
import { tr } from './i18n'

const L = {
  drag: {
    es: 'Arrastra para ajustar el ancho de la timeline · doble clic para restablecer',
    en: 'Drag to resize the timeline · double-click to reset',
  },
}

const view = ref<'live' | 'history'>('live')
const legendOpen = ref(false)

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

// Al estrechar la ventana hay que reajustar: un ancho guardado en una pantalla grande
// dejaría el escenario en nada al abrir la app en un portátil.
let observer: ResizeObserver | null = null
onMounted(() => {
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

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="app" :class="{ dragging }">
    <Hud :view="view" @view="view = $event" @legend="legendOpen = true" />

    <ReplayBar v-if="isReplaying && view === 'live'" />

    <HistoryView v-if="view === 'history'" @open="view = 'live'" />

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

    <Legend v-if="legendOpen" @close="legendOpen = false" />
  </div>
</template>
