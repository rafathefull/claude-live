<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TOUR, stepAt, type TourView } from '../tour'
import { tr } from '../i18n'

/**
 * Bocadillos del recorrido guiado: uno por parada, anclado al sitio del que habla.
 *
 * No es modal a propósito: mientras lees puedes seguir tocando el mundo. El recuadro que resalta
 * el sitio no recibe el ratón, así que no estorba; el único que lo recibe es el bocadillo.
 */

const L = {
  next: { es: 'siguiente ›', en: 'next ›' },
  prev: { es: '‹ antes', en: '‹ back' },
  close: { es: 'Cerrar el recorrido', en: 'Close the tour' },
  done: { es: 'Listo', en: 'Done' },
}

const props = defineProps<{ view: TourView }>()
const emit = defineEmits<{
  (e: 'view', value: TourView): void
  (e: 'close'): void
}>()

const index = ref(0)
const step = computed(() => TOUR[index.value]!)
const isLast = computed(() => index.value === TOUR.length - 1)

/** Recuadro del sitio del que habla el paso, en píxeles de ventana. */
const spot = ref<{ x: number; y: number; w: number; h: number } | null>(null)

function measure(): void {
  const anchor = step.value.anchor
  if (anchor.kind === 'center') {
    spot.value = null
    return
  }
  if (anchor.kind === 'css') {
    const el = document.querySelector(anchor.selector)
    if (!el) {
      spot.value = null
      return
    }
    const rect = el.getBoundingClientRect()
    spot.value = { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    return
  }
  // Punto del escenario: las mismas fracciones que usa el mundo para colocar sus cosas.
  const canvas = document.querySelector('.stage canvas')
  if (!canvas) {
    spot.value = null
    return
  }
  const rect = canvas.getBoundingClientRect()
  const r = anchor.r ?? 60
  spot.value = {
    x: rect.left + rect.width * anchor.x - r,
    y: rect.top + rect.height * anchor.y - r,
    w: r * 2,
    h: r * 2,
  }
}

const BUBBLE_W = 380
const BUBBLE_H = 260

/** El bocadillo se pone al lado del sitio, y si no cabe se va al otro lado. */
const bubbleStyle = computed(() => {
  const target = spot.value
  if (!target) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  }
  const margin = 14
  const room = window.innerWidth - (target.x + target.w)
  const left =
    room > BUBBLE_W + margin
      ? target.x + target.w + margin
      : Math.max(margin, target.x - BUBBLE_W - margin)
  const top = Math.max(
    margin,
    Math.min(window.innerHeight - BUBBLE_H - margin, target.y + target.h / 2 - BUBBLE_H / 3),
  )
  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
})

async function go(to: number): Promise<void> {
  const next = stepAt(to)
  index.value = next
  const wanted = TOUR[next]!.view
  // Cada parada vive en su pestaña: el recorrido la abre solo, y hay que esperar a que el DOM
  // exista antes de medir dónde está lo que se quiere resaltar.
  if (wanted !== props.view) emit('view', wanted)
  await nextTick()
  setTimeout(measure, 160)
}

function finish(): void {
  localStorage.setItem('claude-live:tour-seen', '1')
  emit('close')
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') finish()
  else if (event.key === 'ArrowRight') void go(index.value + 1)
  else if (event.key === 'ArrowLeft') void go(index.value - 1)
}

onMounted(() => {
  void go(0)
  window.addEventListener('resize', measure)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('keydown', onKey)
})

// Si la vista cambia por su cuenta (el propio recorrido, o tú tocando pestañas), hay que volver
// a medir: el sitio del paso puede haberse movido o dejado de existir.
watch(() => props.view, () => setTimeout(measure, 160))
</script>

<template>
  <div class="tour">
    <div v-if="spot" class="tour-spot" :style="{ left: `${spot.x}px`, top: `${spot.y}px`, width: `${spot.w}px`, height: `${spot.h}px` }" />

    <aside class="tour-bubble" :style="bubbleStyle">
      <header>
        <span class="tour-count">{{ index + 1 }}/{{ TOUR.length }}</span>
        <strong>{{ tr(step.title) }}</strong>
        <button class="tour-x" :title="tr(L.close)" @click="finish">✕</button>
      </header>
      <p>{{ tr(step.body) }}</p>
      <footer>
        <button :disabled="index === 0" @click="go(index - 1)">{{ tr(L.prev) }}</button>
        <button v-if="!isLast" class="tour-next" @click="go(index + 1)">{{ tr(L.next) }}</button>
        <button v-else class="tour-next" @click="finish">{{ tr(L.done) }}</button>
      </footer>
    </aside>
  </div>
</template>
