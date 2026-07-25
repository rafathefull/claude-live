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

const L = {
  start: { es: 'Al principio', en: 'To the start' },
  back: { es: 'Atrás 10 eventos', en: 'Back 10 events' },
  play: { es: 'Reproducir', en: 'Play' },
  pause: { es: 'Pausa', en: 'Pause' },
  forward: { es: 'Adelante 10 eventos', en: 'Forward 10 events' },
  end: { es: 'Al final', en: 'To the end' },
  close: {
    es: 'Cerrar el reproductor (podrás volver a abrirlo con «⏵ Reproducir» en la cabecera)',
    en: 'Close the player (you can reopen it with "⏵ Replay" in the header)',
  },
}

/** Salto de los botones «atrás/adelante»: un puñado de eventos, no uno solo. */
const JUMP = 10

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
      <button :title="tr(L.end)" @click="seekTo(replay.total)">⏭</button>
    </div>

    <span class="replay-time">{{ currentTs }}</span>

    <input
      class="scrub"
      type="range"
      min="0"
      :max="replay.total"
      :value="position"
      @input="onScrub"
    />

    <span class="replay-time">{{ endTs }}</span>
    <span class="replay-count">{{ position }} / {{ replay.total }}</span>

    <div class="replay-speeds">
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
