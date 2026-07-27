<script setup lang="ts">
import { computed } from 'vue'
import { isReplaying, liveSessions, resumeReplay, selectedSession, state, stopReplay } from '../store'
import { contextPercent, formatTokens } from '../format'
import { lang, setLang, tr } from '../i18n'
import { theme, toggleTheme } from '../theme'

/** Textos de la cabecera, con sus dos versiones juntas. */
const L = {
  live: { es: 'En vivo', en: 'Live' },
  history: { es: 'Historial', en: 'History' },
  noSession: { es: 'ninguna sesión de Claude abierta', en: 'no Claude session open' },
  branch: { es: 'rama', en: 'branch' },
  model: { es: 'modelo', en: 'model' },
  mode: { es: 'modo', en: 'mode' },
  context: { es: 'contexto', en: 'context' },
  tokens: { es: 'tokens', en: 'tokens' },
  state: { es: 'estado', en: 'state' },
  busy: { es: 'trabajando', en: 'working' },
  idle: { es: 'esperándote', en: 'waiting for you' },
  dead: { es: 'cerrada', en: 'closed' },
  replay: { es: '⏵ Reproducir', en: '⏵ Replay' },
  replayTitle: {
    es: 'Volver a reproducir esta conversación del historial',
    en: 'Replay this conversation from the history again',
  },
  legend: { es: '❔ Leyenda', en: '❔ Legend' },
  legendTitle: {
    es: 'Qué significa cada lugar, actor y color del mundo',
    en: 'What every place, actor and colour in the world means',
  },
  themeTitle: {
    es: 'Cambiar entre tema claro y oscuro',
    en: 'Switch between light and dark theme',
  },
  sober: { es: 'Modo sobrio', en: 'Plain mode' },
  world: { es: 'Mundo', en: 'World' },
  connected: { es: 'conectado al servidor', en: 'connected to the server' },
  reconnecting: { es: 'reconectando…', en: 'reconnecting…' },
  toSpanish: { es: 'Interfaz en castellano', en: 'Switch the interface to Spanish' },
  toEnglish: { es: 'Cambiar la interfaz a inglés', en: 'Interface in English' },
}

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
      return tr(L.busy)
    case 'idle':
      return tr(L.idle)
    case 'dead':
      return tr(L.dead)
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
        {{ tr(L.live) }}
      </button>
      <button :class="{ active: props.view === 'history' }" @click="emit('view', 'history')">
        {{ tr(L.history) }}
      </button>
    </div>

    <span class="sep">│</span>

    <div class="session-picker">
      <span v-if="liveSessions.length === 0" class="muted">
        {{ tr(L.noSession) }}
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
        <span class="label">{{ tr(L.branch) }}</span>
        <span>{{ session.gitBranch ?? '—' }}</span>
      </div>
      <div class="metric">
        <span class="label">{{ tr(L.model) }}</span>
        <span>{{ session.model ?? '—' }}</span>
      </div>
      <div class="metric">
        <span class="label">{{ tr(L.mode) }}</span>
        <span>{{ session.permissionMode ?? session.mode ?? '—' }}</span>
      </div>
      <div class="metric" :title="`${session.lastContextTokens ?? 0} tokens en la última petición`">
        <span class="label">{{ tr(L.context) }}</span>
        <span class="bar"><span :style="{ width: `${ctx}%` }" /></span>
        <span>{{ ctx }}%</span>
      </div>
      <div
        class="metric"
        :title="`entrada ${session.tokens?.input ?? 0} · salida ${session.tokens?.output ?? 0} · caché ${session.tokens?.cacheRead ?? 0}`"
      >
        <span class="label">{{ tr(L.tokens) }}</span>
        <span>{{ formatTokens((session.tokens?.input ?? 0) + (session.tokens?.output ?? 0)) }}</span>
      </div>
      <div class="metric">
        <span class="label">{{ tr(L.state) }}</span>
        <span>{{ statusLabel }}</span>
      </div>
    </template>

    <div class="spacer" />

    <button
      v-if="session && !session.live && !isReplaying"
      class="reopen-replay"
      :title="tr(L.replayTitle)"
      @click="resumeReplay(session.sessionId)"
    >
      {{ tr(L.replay) }}
    </button>
    <button :title="tr(L.legendTitle)" @click="emit('legend')">
      {{ tr(L.legend) }}
    </button>
    <div class="lang-switch" role="group" aria-label="idioma / language">
      <button
        :class="{ active: lang === 'es' }"
        :title="tr(L.toSpanish)"
        lang="es"
        @click="setLang('es')"
      >
        <span class="flag" aria-hidden="true">🇪🇸</span> ES
      </button>
      <button
        :class="{ active: lang === 'en' }"
        :title="tr(L.toEnglish)"
        lang="en"
        @click="setLang('en')"
      >
        <span class="flag" aria-hidden="true">🇬🇧</span> EN
      </button>
    </div>
    <button class="theme-toggle" :title="tr(L.themeTitle)" @click="toggleTheme">
      {{ theme === 'dark' ? '☀' : '🌙' }}
    </button>
    <button :class="{ active: state.soberMode }" @click="state.soberMode = !state.soberMode">
      {{ state.soberMode ? tr(L.sober) : tr(L.world) }}
    </button>
    <span class="metric" :title="state.connected ? tr(L.connected) : tr(L.reconnecting)">
      <i class="dot" :class="state.connected ? 'busy' : 'dead'" />
    </span>
  </header>
</template>
