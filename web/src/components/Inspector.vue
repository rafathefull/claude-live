<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { loadRaw, state } from '../store'
import { formatDuration, formatTime, shortTool } from '../format'
import { tr } from '../i18n'

const L = {
  noPayload: { es: '(sin payload)', en: '(no payload)' },
  truncated: { es: '· recortado', en: '· truncated' },
  full: { es: 'ver completo', en: 'show full' },
}

const raw = ref<unknown>(null)
const loading = ref(false)

const event = computed(() => state.selectedEvent)

watch(event, () => {
  raw.value = null
})

const pretty = computed(() => {
  if (raw.value !== null) return JSON.stringify(raw.value, null, 2)
  const payload = event.value?.payload
  if (payload === undefined) return '(sin payload)'
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
})

async function fetchRaw(): Promise<void> {
  const current = event.value
  if (!current) return
  loading.value = true
  try {
    raw.value = await loadRaw(current.sessionId, current.uuid)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <aside v-if="event" class="inspector">
    <header>
      <strong>{{ shortTool(event.tool) || event.kind }}</strong>
      <span class="muted">{{ formatTime(event.ts) }}</span>
      <span v-if="event.durationMs !== undefined" class="muted">
        {{ formatDuration(event.durationMs) }}
      </span>
      <span v-if="event.truncated" class="muted">{{ tr(L.truncated) }}</span>
      <span class="spacer" style="margin-left: auto" />
      <button :disabled="loading" @click="fetchRaw">
        {{ loading ? '…' : tr(L.full) }}
      </button>
      <button @click="state.selectedEvent = null">✕</button>
    </header>
    <pre>{{ pretty }}</pre>
  </aside>
</template>
