<script setup lang="ts">
import { computed } from 'vue'
import { liveSessions, selectedSession, state, stopReplay } from '../store'
import { contextPercent, formatTokens } from '../format'

const props = defineProps<{ view: 'live' | 'history' }>()
const emit = defineEmits<{
  (e: 'view', value: 'live' | 'history'): void
  (e: 'legend'): void
}>()

const session = selectedSession
const ctx = computed(() => (session.value ? contextPercent(session.value) : 0))
/** Volver al directo cierra el reproductor si estaba abierto. */
function selectLive(sessionId: string): void {
  stopReplay()
  state.selectedSessionId = sessionId
}

const statusLabel = computed(() => {
  switch (session.value?.status) {
    case 'busy':
      return 'trabajando'
    case 'idle':
      return 'esperándote'
    case 'dead':
      return 'cerrada'
    default:
      return '—'
  }
})
</script>

<template>
  <header class="hud">
    <span class="brand">claude-live</span>

    <div class="tabs">
      <button :class="{ active: props.view === 'live' }" @click="emit('view', 'live')">
        En vivo
      </button>
      <button :class="{ active: props.view === 'history' }" @click="emit('view', 'history')">
        Historial
      </button>
    </div>

    <span class="sep">│</span>

    <div class="session-picker">
      <span v-if="liveSessions.length === 0" class="muted">
        ninguna sesión de Claude abierta
      </span>
      <span
        v-for="s in liveSessions"
        :key="s.sessionId"
        class="session-chip"
        :class="{ selected: s.sessionId === state.selectedSessionId }"
        :title="`${s.cwd} · pid ${s.pid} · v${s.version}`"
        @click="selectLive(s.sessionId)"
      >
        <i class="dot" :class="s.status" />
        {{ s.project }}
        <span class="muted" v-if="s.background">bg</span>
      </span>
    </div>

    <template v-if="session">
      <span class="sep">│</span>
      <div class="metric" :title="session.cwd">
        <span class="label">rama</span>
        <span>{{ session.gitBranch ?? '—' }}</span>
      </div>
      <div class="metric">
        <span class="label">modelo</span>
        <span>{{ session.model ?? '—' }}</span>
      </div>
      <div class="metric">
        <span class="label">modo</span>
        <span>{{ session.permissionMode ?? session.mode ?? '—' }}</span>
      </div>
      <div class="metric" :title="`${session.lastContextTokens ?? 0} tokens en la última petición`">
        <span class="label">contexto</span>
        <span class="bar"><span :style="{ width: `${ctx}%` }" /></span>
        <span>{{ ctx }}%</span>
      </div>
      <div
        class="metric"
        :title="`entrada ${session.tokens?.input ?? 0} · salida ${session.tokens?.output ?? 0} · caché ${session.tokens?.cacheRead ?? 0}`"
      >
        <span class="label">tokens</span>
        <span>{{ formatTokens((session.tokens?.input ?? 0) + (session.tokens?.output ?? 0)) }}</span>
      </div>
      <div class="metric">
        <span class="label">estado</span>
        <span>{{ statusLabel }}</span>
      </div>
    </template>

    <div class="spacer" />

    <button title="Qué significa cada lugar, actor y color del mundo" @click="emit('legend')">
      ❔ Leyenda
    </button>
    <button :class="{ active: state.soberMode }" @click="state.soberMode = !state.soberMode">
      {{ state.soberMode ? 'Modo sobrio' : 'Mundo' }}
    </button>
    <span class="metric" :title="state.connected ? 'conectado al servidor' : 'reconectando…'">
      <i class="dot" :class="state.connected ? 'busy' : 'dead'" />
    </span>
  </header>
</template>
