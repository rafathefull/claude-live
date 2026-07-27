<script setup lang="ts">
import { computed } from 'vue'
import {
  SPEEDS,
  allEvents,
  seekTo,
  selectedSession,
  setSpeed,
  state,
  step,
  stopReplay,
  togglePlay,
} from '../store'
import { formatTime } from '../format'
import { tr } from '../i18n'
/** El salto de los botones es el mismo que el de ⇧← / ⇧→: teclado y ratón no deben discrepar. */
import { JUMP } from '../shortcuts'

// Cada botón lleva su tecla en el tooltip: así los atajos se descubren usándolo, sin tener
// que ir a la leyenda.
const L = {
  start: { es: 'Al principio · Inicio', en: 'To the start · Home' },
  back: { es: 'Atrás 10 eventos · ⇧←  (← uno)', en: 'Back 10 events · ⇧←  (← one)' },
  play: { es: 'Reproducir · espacio', en: 'Play · space' },
  pause: { es: 'Pausa · espacio', en: 'Pause · space' },
  forward: { es: 'Adelante 10 eventos · ⇧→  (→ uno)', en: 'Forward 10 events · ⇧→  (→ one)' },
  end: { es: 'Al final · Fin', en: 'To the end · End' },
  speed: { es: 'Velocidad · ↑ y ↓', en: 'Speed · ↑ and ↓' },
  loading: { es: 'trayendo más…', en: 'loading more…' },
  close: {
    es: 'Cerrar el reproductor (podrás volver a abrirlo con «⏵ Reproducir» en la cabecera)',
    en: 'Close the player (you can reopen it with "⏵ Replay" in the header)',
  },
}


const replay = computed(() => state.replay)
const position = computed(() => Math.min(state.replay.index, state.replay.total))
const currentTs = computed(() => {
  const events = allEvents.value
  const event = events[Math.max(0, position.value - 1)]
  return event ? formatTime(event.ts) : '--:--:--'
})
const endTs = computed(() => {
  const events = allEvents.value
  const last = events[events.length - 1]
  return last ? formatTime(last.ts) : '--:--:--'
})

function onScrub(event: Event): void {
  seekTo(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="replay-bar">
    <div class="replay-controls">
      <button :title="tr(L.start)" @click="seekTo(0)">⏮</button>
      <button :title="tr(L.back)" @click="step(-JUMP)">⏪</button>
      <button class="play" :title="replay.playing ? tr(L.pause) : tr(L.play)" @click="togglePlay">
        {{ replay.playing ? '⏸' : '⏵' }}
      </button>
      <button :title="tr(L.forward)" @click="step(JUMP)">⏩</button>
      <button :title="tr(L.end)" @click="seekTo(replay.total + replay.pending)">⏭</button>
    </div>

    <span class="replay-time">{{ currentTs }}</span>

    <input
      class="scrub"
      type="range"
      min="0"
      :max="replay.total + replay.pending"
      :value="position"
      @input="onScrub"
    />

    <span class="replay-time">{{ endTs }}</span>
    <span class="replay-count">
      {{ position }} / {{ replay.total + replay.pending }}
      <span v-if="replay.pending > 0" class="muted" :title="tr(L.loading)">…</span>
    </span>

    <div class="replay-speeds" :title="tr(L.speed)">
      <button
        v-for="speed in SPEEDS"
        :key="speed"
        :class="{ active: replay.speed === speed }"
        @click="setSpeed(speed)"
      >
        {{ speed }}×
      </button>
    </div>

    <span class="replay-title" :title="selectedSession?.aiTitle">
      {{ selectedSession?.aiTitle ?? '' }}
    </span>

    <button
      :title="tr(L.close)"
      @click="stopReplay"
    >
      ✕
    </button>
  </div>
</template>
