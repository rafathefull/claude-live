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
      <button title="Al principio" @click="seekTo(0)">⏮</button>
      <button :title="`Atrás ${JUMP} eventos`" @click="step(-JUMP)">⏪</button>
      <button class="play" :title="replay.playing ? 'Pausa' : 'Reproducir'" @click="togglePlay">
        {{ replay.playing ? '⏸' : '⏵' }}
      </button>
      <button :title="`Adelante ${JUMP} eventos`" @click="step(JUMP)">⏩</button>
      <button title="Al final" @click="seekTo(replay.total)">⏭</button>
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

    <span class="replay-title muted" :title="selectedSession?.aiTitle">
      {{ selectedSession?.aiTitle ?? '' }}
    </span>

    <button title="Salir del reproductor y volver al directo" @click="stopReplay">✕</button>
  </div>
</template>
