<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  loadAllSessions,
  loadRetention,
  loadSessionEvents,
  startReplay,
  state,
  stopReplay,
  type Retention,
} from '../store'
import { formatDate, formatTokens } from '../format'
import type { SessionInfo } from '@shared/types'
import { tr } from '../i18n'

const L = {
  search: {
    es: 'Buscar por proyecto, título, rama o modelo…',
    en: 'Search by project, title, branch or model…',
  },
  indexing: { es: 'Indexando transcripts…', en: 'Indexing transcripts…' },
  lastActivity: { es: 'Última actividad', en: 'Last activity' },
  project: { es: 'Proyecto', en: 'Project' },
  title: { es: 'Título', en: 'Title' },
  branch: { es: 'Rama', en: 'Branch' },
  model: { es: 'Modelo', en: 'Model' },
  context: { es: 'Contexto', en: 'Context' },
  size: { es: 'Tamaño', en: 'Size' },
  none: { es: 'Ninguna sesión coincide.', en: 'No session matches.' },
  retentionTitle: {
    es: 'Esto no es todo tu historial',
    en: 'This is not your whole history',
  },
  howTo: {
    es: 'Para conservar más, añade "cleanupPeriodDays" a ~/.claude/settings.json (por ejemplo 365) y reinicia Claude Code. Lo ya borrado no se recupera.',
    en: 'To keep more, add "cleanupPeriodDays" to ~/.claude/settings.json (365, for instance) and restart Claude Code. What is already deleted cannot be recovered.',
  },
  dismiss: { es: 'Entendido', en: 'Got it' },
}

const emit = defineEmits<{ (e: 'open'): void }>()

const sessions = ref<SessionInfo[]>([])
const query = ref('')
const loading = ref(true)
const retention = ref<Retention | null>(null)
const noticeHidden = ref(localStorage.getItem('claude-live:retention-seen') === '1')

onMounted(async () => {
  sessions.value = await loadAllSessions()
  loading.value = false
  retention.value = await loadRetention()
})

/** El aviso solo tiene sentido si de verdad falta historia. */
const showNotice = computed(
  () => !noticeHidden.value && (retention.value?.missing ?? 0) > 0,
)

function dismissNotice(): void {
  noticeHidden.value = true
  localStorage.setItem('claude-live:retention-seen', '1')
}

/** El aviso con los números reales de esta máquina. */
const noticeText = computed(() => {
  const info = retention.value
  if (!info) return ''
  const since = info.oldest
    ? new Date(info.oldest).toLocaleDateString(tr({ es: 'es-ES', en: 'en-GB' }), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—'
  return tr({
    es: `Claude Code borra los transcripts pasados ${info.cleanupPeriodDays} días${
      info.configured ? '' : ' (su valor por omisión)'
    }. Aquí hay ${info.onDisk} sesiones, la más antigua del ${since}, pero consta que has tenido ${info.known}: faltan ${info.missing}.`,
    en: `Claude Code deletes transcripts after ${info.cleanupPeriodDays} days${
      info.configured ? '' : ' (its default)'
    }. There are ${info.onDisk} sessions here, the oldest from ${since}, but there is a record of ${info.known}: ${info.missing} are missing.`,
  })
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return sessions.value
  return sessions.value.filter((s) =>
    [s.project, s.aiTitle, s.cwd, s.gitBranch, s.model].some((field) =>
      (field ?? '').toLowerCase().includes(q),
    ),
  )
})

async function open(session: SessionInfo): Promise<void> {
  if (!state.sessions.some((s) => s.sessionId === session.sessionId)) {
    state.sessions = [...state.sessions, session]
  }
  // Primero los eventos y después la selección: al revés el mundo se poblaba con un
  // array todavía vacío y la conversación parecía tener cuatro pasos.
  const count = await loadSessionEvents(session.sessionId)
  state.selectedSessionId = session.sessionId
  if (session.live) {
    stopReplay()
  } else {
    startReplay(session.sessionId, count)
  }
  emit('open')
}
</script>

<template>
  <div class="history">
    <aside v-if="showNotice" class="retention-notice">
      <strong>⚠ {{ tr(L.retentionTitle) }}</strong>
      <p>{{ noticeText }}</p>
      <p class="muted">{{ tr(L.howTo) }}</p>
      <button @click="dismissNotice">{{ tr(L.dismiss) }}</button>
    </aside>

    <input v-model="query" class="search" :placeholder="tr(L.search)" />
    <p v-if="loading" class="muted">{{ tr(L.indexing) }}</p>
    <table v-else>
      <thead>
        <tr>
          <th>{{ tr(L.lastActivity) }}</th>
          <th>{{ tr(L.project) }}</th>
          <th>{{ tr(L.title) }}</th>
          <th>{{ tr(L.branch) }}</th>
          <th>{{ tr(L.model) }}</th>
          <th>{{ tr(L.context) }}</th>
          <th>{{ tr(L.size) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in filtered" :key="s.sessionId" @click="open(s)">
          <td>{{ formatDate(s.lastTs) }}</td>
          <td>
            <i v-if="s.live" class="dot" :class="s.status" />
            {{ s.project }}
          </td>
          <td :title="s.aiTitle">{{ s.aiTitle }}</td>
          <td>{{ s.gitBranch ?? '—' }}</td>
          <td>{{ s.model ?? '—' }}</td>
          <td>{{ formatTokens(s.lastContextTokens) }}</td>
          <td>{{ ((s.sizeBytes ?? 0) / 1024).toFixed(0) }} KB</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!loading && filtered.length === 0" class="muted">{{ tr(L.none) }}</p>
  </div>
</template>
