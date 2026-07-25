<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { loadAllSessions, loadSessionEvents, startReplay, state, stopReplay } from '../store'
import { formatDate, formatTokens } from '../format'
import type { SessionInfo } from '@shared/types'

const emit = defineEmits<{ (e: 'open'): void }>()

const sessions = ref<SessionInfo[]>([])
const query = ref('')
const loading = ref(true)

onMounted(async () => {
  sessions.value = await loadAllSessions()
  loading.value = false
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
    <input v-model="query" class="search" placeholder="Buscar por proyecto, título, rama o modelo…" />
    <p v-if="loading" class="muted">Indexando transcripts…</p>
    <table v-else>
      <thead>
        <tr>
          <th>Última actividad</th>
          <th>Proyecto</th>
          <th>Título</th>
          <th>Rama</th>
          <th>Modelo</th>
          <th>Contexto</th>
          <th>Tamaño</th>
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
    <p v-if="!loading && filtered.length === 0" class="muted">Ninguna sesión coincide.</p>
  </div>
</template>
