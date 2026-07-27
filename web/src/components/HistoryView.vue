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
  why: { es: '¿por qué?', en: 'why?' },
  table: { es: 'Tabla', en: 'Table' },
  tree: { es: 'Árbol', en: 'Tree' },
  tableHint: {
    es: 'Todas las sesiones en una lista, ordenadas por fecha',
    en: 'Every session in one list, sorted by date',
  },
  treeHint: {
    es: 'Sesiones agrupadas por proyecto',
    en: 'Sessions grouped by project',
  },
  expandAll: { es: 'Abrir todo', en: 'Expand all' },
  collapseAll: { es: 'Cerrar todo', en: 'Collapse all' },
  noTitle: { es: 'sin título', en: 'untitled' },
}

const emit = defineEmits<{ (e: 'open'): void }>()

const sessions = ref<SessionInfo[]>([])
const query = ref('')
const loading = ref(true)
const retention = ref<Retention | null>(null)
const noticeHidden = ref(localStorage.getItem('claude-live:retention-seen') === '1')
/** Vuelve a desplegar el aviso desde la línea discreta, solo para esta visita. */
const noticeReopened = ref(false)

onMounted(async () => {
  sessions.value = await loadAllSessions()
  loading.value = false
  // El proyecto más reciente arranca abierto: un árbol enteramente cerrado parece vacío.
  const first = tree.value[0]
  if (first) opened.value = new Set([first.cwd])
  retention.value = await loadRetention()
})

/** El aviso solo tiene sentido si de verdad falta historia. */
const hasGap = computed(() => (retention.value?.missing ?? 0) > 0)
const showNotice = computed(
  () => hasGap.value && (!noticeHidden.value || noticeReopened.value),
)

function dismissNotice(): void {
  noticeHidden.value = true
  noticeReopened.value = false
  localStorage.setItem('claude-live:retention-seen', '1')
}

/**
 * Resumen permanente para cuando el aviso ya se ha descartado: el dato no debería
 * desaparecer del todo, o dentro de un mes vuelves a preguntarte dónde está tu histórico.
 */
const retentionLine = computed(() => {
  const info = retention.value
  if (!info) return ''
  return tr({
    es: `${info.onDisk} de ${info.known} sesiones · retención de ${info.cleanupPeriodDays} días`,
    en: `${info.onDisk} of ${info.known} sessions · ${info.cleanupPeriodDays}-day retention`,
  })
})

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

/* ------------------------------------------------------------------ árbol */

type ProjectNode = {
  cwd: string
  project: string
  sessions: SessionInfo[]
  lastTs: string
  bytes: number
  live: boolean
}

const mode = ref<'table' | 'tree'>(
  localStorage.getItem('claude-live:history-mode') === 'tree' ? 'tree' : 'table',
)

function setMode(next: 'table' | 'tree'): void {
  mode.value = next
  localStorage.setItem('claude-live:history-mode', next)
}

/**
 * Se agrupa por `cwd` y no por nombre de proyecto: dos carpetas distintas pueden llamarse
 * igual (un `backend` por cliente) y mezclarlas sería peor que la lista plana.
 */
const tree = computed<ProjectNode[]>(() => {
  const nodes = new Map<string, ProjectNode>()
  for (const session of filtered.value) {
    const key = session.cwd || session.project || '—'
    const ts = session.lastTs ?? ''
    const node =
      nodes.get(key) ??
      ({ cwd: key, project: session.project || key, sessions: [], lastTs: ts, bytes: 0, live: false } satisfies ProjectNode)
    nodes.set(key, node)
    node.sessions.push(session)
    node.bytes += session.sizeBytes ?? 0
    if (session.live) node.live = true
    if (ts > node.lastTs) node.lastTs = ts
  }
  const list = [...nodes.values()]
  for (const node of list) {
    node.sessions.sort((a, b) => (b.lastTs ?? '').localeCompare(a.lastTs ?? ''))
  }
  // Los proyectos vivos primero, y el resto por actividad reciente: lo que buscas casi
  // siempre es lo último que tocaste.
  return list.sort((a, b) => Number(b.live) - Number(a.live) || b.lastTs.localeCompare(a.lastTs))
})

const opened = ref<Set<string>>(new Set())
/** Un proyecto abierto a mano vuelve a cerrarse; con búsqueda activa se abre todo. */
const isOpen = (cwd: string): boolean => query.value.trim() !== '' || opened.value.has(cwd)

function toggle(cwd: string): void {
  const next = new Set(opened.value)
  if (next.has(cwd)) next.delete(cwd)
  else next.add(cwd)
  opened.value = next
}

function expandAll(): void {
  opened.value = new Set(tree.value.map((node) => node.cwd))
}

function collapseAll(): void {
  opened.value = new Set()
}

function subtitle(session: SessionInfo): string {
  const parts = [session.gitBranch, session.model].filter(Boolean)
  parts.push(`${((session.sizeBytes ?? 0) / 1024).toFixed(0)} KB`)
  return parts.join(' · ')
}

function nodeMeta(node: ProjectNode): string {
  const n = node.sessions.length
  const mb = node.bytes / 1024 / 1024
  const size = mb >= 1 ? `${mb.toFixed(1)} MB` : `${(node.bytes / 1024).toFixed(0)} KB`
  return tr({
    es: `${n} ${n === 1 ? 'sesión' : 'sesiones'} · ${size}`,
    en: `${n} ${n === 1 ? 'session' : 'sessions'} · ${size}`,
  })
}

async function open(session: SessionInfo): Promise<void> {
  if (!state.sessions.some((s) => s.sessionId === session.sessionId)) {
    state.sessions = [...state.sessions, session]
  }
  // Se salta al mundo antes de traer los eventos: un transcript de 11 MB tarda lo suyo, y
  // esperando la carga el clic parecía no hacer nada (había que pulsar «En vivo» a mano).
  state.loadingSession = session.sessionId
  emit('open')
  try {
    // Primero los eventos y después la selección: al revés el mundo se poblaba con un
    // array todavía vacío y la conversación parecía tener cuatro pasos.
    const count = await loadSessionEvents(session.sessionId)
    state.selectedSessionId = session.sessionId
    if (session.live) {
      stopReplay()
    } else {
      startReplay(session.sessionId, count)
    }
  } finally {
    state.loadingSession = null
  }
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

    <p v-if="hasGap && !showNotice" class="retention-line" :title="tr(L.howTo)">
      ⚠ {{ retentionLine }}
      <button class="linkish" @click="noticeReopened = true">{{ tr(L.why) }}</button>
    </p>

    <div class="history-bar">
      <input v-model="query" class="search" :placeholder="tr(L.search)" />
      <div class="modes">
        <button
          :class="{ active: mode === 'table' }"
          :title="tr(L.tableHint)"
          @click="setMode('table')"
        >
          ☰ {{ tr(L.table) }}
        </button>
        <button
          :class="{ active: mode === 'tree' }"
          :title="tr(L.treeHint)"
          @click="setMode('tree')"
        >
          🌳 {{ tr(L.tree) }}
        </button>
      </div>
    </div>

    <p v-if="loading" class="muted">{{ tr(L.indexing) }}</p>

    <!-- Árbol: proyectos plegables, para ubicarse sin recorrer ochenta filas. -->
    <div v-else-if="mode === 'tree'" class="tree">
      <div class="tree-tools">
        <button class="linkish" @click="expandAll">{{ tr(L.expandAll) }}</button>
        <button class="linkish" @click="collapseAll">{{ tr(L.collapseAll) }}</button>
      </div>
      <section v-for="node in tree" :key="node.cwd" class="tree-node">
        <button class="tree-head" :title="node.cwd" @click="toggle(node.cwd)">
          <span class="caret">{{ isOpen(node.cwd) ? '▾' : '▸' }}</span>
          <span class="folder">{{ isOpen(node.cwd) ? '📂' : '📁' }}</span>
          <strong>{{ node.project }}</strong>
          <i v-if="node.live" class="dot busy" />
          <span class="node-meta">{{ nodeMeta(node) }}</span>
          <span class="node-when">{{ formatDate(node.lastTs) }}</span>
        </button>
        <ul v-if="isOpen(node.cwd)">
          <li v-for="s in node.sessions" :key="s.sessionId" @click="open(s)">
            <i v-if="s.live" class="dot" :class="s.status" />
            <span class="leaf-when">{{ formatDate(s.lastTs) }}</span>
            <span class="leaf-title" :title="s.aiTitle">{{ s.aiTitle || tr(L.noTitle) }}</span>
            <span class="leaf-meta">{{ subtitle(s) }}</span>
          </li>
        </ul>
      </section>
    </div>

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
