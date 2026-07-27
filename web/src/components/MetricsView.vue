<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { loadMetrics } from '../store'
import {
  ALL_PROJECTS,
  series,
  top,
  totals,
  valueOf,
  type Measure,
} from '../metrics'
import { formatTokens } from '../format'
import { tr } from '../i18n'
import type { Metrics } from '@shared/types'

/**
 * Métricas por proyecto y por día.
 *
 * Barras dibujadas con CSS, sin librería de gráficas: son cuatro rectángulos y así el visor no
 * arrastra otra dependencia. El servidor hace el trabajo pesado (recorrer los transcripts) y
 * cachea por fichero; aquí solo se filtra y se suma.
 */

const L = {
  title: { es: 'Métricas', en: 'Metrics' },
  loading: { es: 'Recorriendo los transcripts…', en: 'Walking the transcripts…' },
  none: {
    es: 'No hay transcripts que medir todavía.',
    en: 'No transcripts to measure yet.',
  },
  project: { es: 'Proyecto', en: 'Project' },
  all: { es: 'todos', en: 'all' },
  range: { es: 'Rango', en: 'Range' },
  everything: { es: 'todo', en: 'everything' },
  days: { es: 'días', en: 'days' },
  measure: { es: 'Medida', en: 'Measure' },
  events: { es: 'eventos', en: 'events' },
  toolCalls: { es: 'herramientas', en: 'tool calls' },
  tokens: { es: 'tokens', en: 'tokens' },
  sessions: { es: 'sesiones', en: 'sessions' },
  errors: { es: 'errores', en: 'errors' },
  prompts: { es: 'peticiones tuyas', en: 'your prompts' },
  agents: { es: 'subagentes', en: 'subagents' },
  cache: { es: 'tokens de caché', en: 'cache tokens' },
  size: { es: 'en disco', en: 'on disk' },
  perProject: { es: 'Por proyecto', en: 'By project' },
  topTools: { es: 'Herramientas más usadas', en: 'Most used tools' },
  models: { es: 'Modelos', en: 'Models' },
  agentTypes: { es: 'Tipos de subagente', en: 'Subagent types' },
  recompute: { es: 'Recalcular', en: 'Recompute' },
  recomputeTitle: {
    es: 'Vuelve a recorrer todos los transcripts, ignorando la caché',
    en: 'Walk every transcript again, ignoring the cache',
  },
  note: {
    es: 'El trabajo se reparte por el día de cada evento, no por el de la sesión: una conversación de madrugada cuenta en los dos días. Los subagentes se cuentan por su propio transcript.',
    en: 'Work is spread by the day of each event, not of the session: a conversation past midnight counts on both days. Subagents are counted by their own transcript.',
  },
  cached: { es: 'de la caché', en: 'from cache' },
  reread: { es: 'releídos', en: 're-read' },
  empty: { es: 'sin actividad', en: 'no activity' },
  peak: { es: 'máximo del rango:', en: 'range peak:' },
}

const MEASURES: { key: Measure; label: { es: string; en: string } }[] = [
  { key: 'events', label: L.events },
  { key: 'toolCalls', label: L.toolCalls },
  { key: 'tokens', label: L.tokens },
  { key: 'sessions', label: L.sessions },
  { key: 'errors', label: L.errors },
]

const RANGES = [7, 30, 90, 0]

const metrics = ref<Metrics | null>(null)
const loading = ref(true)
const project = ref(ALL_PROJECTS)
const range = ref(30)
const measure = ref<Measure>('events')

async function refresh(force = false): Promise<void> {
  loading.value = true
  metrics.value = await loadMetrics(force)
  loading.value = false
}

onMounted(() => refresh())

const projects = computed(() =>
  Object.entries(metrics.value?.byProject ?? {})
    // Un transcript vacío o sin `cwd` legible deja un proyecto a cero: es ruido en la tabla.
    .filter(([, bucket]) => bucket.events > 0 || bucket.sessions > 0)
    .sort((a, b) => b[1].events - a[1].events)
    .map(([name, bucket]) => ({ name, bucket })),
)

const points = computed(() =>
  metrics.value ? series(metrics.value, project.value, range.value) : [],
)
const sum = computed(() => totals(points.value))
const peak = computed(() =>
  Math.max(1, ...points.value.map((point) => valueOf(point.bucket, measure.value))),
)

const tools = computed(() => top(metrics.value?.tools ?? {}, 10))
const models = computed(() => top(metrics.value?.models ?? {}, 6))
const agentTypes = computed(() => top(metrics.value?.agentTypes ?? {}, 6))

/** Alto de cada barra, en porcentaje del pico del rango. */
function heightOf(value: number): string {
  return `${Math.max(value > 0 ? 3 : 0, Math.round((value / peak.value) * 100))}%`
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

/** `2026-07-27` → `27/7`, que es lo que cabe debajo de una barra. */
function shortDay(day: string): string {
  const [, month, dayOfMonth] = day.split('-')
  return `${Number(dayOfMonth)}/${Number(month)}`
}

const measureLabel = computed(
  () => MEASURES.find((entry) => entry.key === measure.value)?.label ?? L.events,
)
</script>

<template>
  <div class="metrics">
    <header class="metrics-head">
      <strong>📊 {{ tr(L.title) }}</strong>
      <template v-if="metrics">
        <span class="muted">
          {{ metrics.transcripts }} transcripts ·
          {{ metrics.reread === 0 ? tr(L.cached) : `${metrics.reread} ${tr(L.reread)}` }} ·
          {{ metrics.computedInMs }} ms
        </span>
        <button :title="tr(L.recomputeTitle)" @click="refresh(true)">↻ {{ tr(L.recompute) }}</button>
      </template>
    </header>

    <p v-if="loading" class="muted">{{ tr(L.loading) }}</p>
    <p v-else-if="!metrics || metrics.transcripts === 0" class="muted">{{ tr(L.none) }}</p>

    <template v-else>
      <div class="metrics-controls">
        <label>
          {{ tr(L.project) }}
          <select v-model="project">
            <option :value="ALL_PROJECTS">{{ tr(L.all) }}</option>
            <option v-for="entry in projects" :key="entry.name" :value="entry.name">
              {{ entry.name }}
            </option>
          </select>
        </label>
        <label>
          {{ tr(L.range) }}
          <span class="chips">
            <button
              v-for="value in RANGES"
              :key="value"
              :class="{ active: range === value }"
              @click="range = value"
            >
              {{ value === 0 ? tr(L.everything) : `${value} ${tr(L.days)}` }}
            </button>
          </span>
        </label>
        <label>
          {{ tr(L.measure) }}
          <span class="chips">
            <button
              v-for="entry in MEASURES"
              :key="entry.key"
              :class="{ active: measure === entry.key }"
              @click="measure = entry.key"
            >
              {{ tr(entry.label) }}
            </button>
          </span>
        </label>
      </div>

      <!-- Totales del rango elegido, no del histórico entero. -->
      <div class="metrics-totals">
        <span><b>{{ sum.sessions }}</b> {{ tr(L.sessions) }}</span>
        <span><b>{{ sum.prompts }}</b> {{ tr(L.prompts) }}</span>
        <span><b>{{ sum.events }}</b> {{ tr(L.events) }}</span>
        <span><b>{{ sum.toolCalls }}</b> {{ tr(L.toolCalls) }}</span>
        <span :class="{ bad: sum.errors > 0 }"><b>{{ sum.errors }}</b> {{ tr(L.errors) }}</span>
        <span><b>{{ sum.agents }}</b> {{ tr(L.agents) }}</span>
        <span><b>{{ formatTokens(sum.tokensIn + sum.tokensOut) }}</b> {{ tr(L.tokens) }}</span>
        <span><b>{{ formatTokens(sum.tokensCache) }}</b> {{ tr(L.cache) }}</span>
        <span><b>{{ formatBytes(sum.bytes) }}</b> {{ tr(L.size) }}</span>
      </div>

      <!-- Barras por día. Los días sin actividad se dibujan vacíos: si se saltaran, una semana
           sin tocar nada parecería una semana de trabajo seguido. -->
      <div class="chart-scale muted">
        {{ tr(L.peak) }} {{ measure === 'tokens' ? formatTokens(peak) : peak }}
        {{ tr(measureLabel) }}
      </div>
      <div class="chart">
        <div
          v-for="point in points"
          :key="point.day"
          class="chart-col"
          :title="`${point.day} · ${valueOf(point.bucket, measure)} ${tr(measureLabel)}`"
        >
          <span class="chart-bar" :style="{ height: heightOf(valueOf(point.bucket, measure)) }" />
          <span class="chart-day">{{ shortDay(point.day) }}</span>
        </div>
        <p v-if="points.length === 0" class="muted">{{ tr(L.empty) }}</p>
      </div>

      <div class="metrics-grid">
        <section>
          <h3>{{ tr(L.perProject) }}</h3>
          <table>
            <thead>
              <tr>
                <th>{{ tr(L.project) }}</th>
                <th>{{ tr(L.sessions) }}</th>
                <th>{{ tr(L.events) }}</th>
                <th>{{ tr(L.toolCalls) }}</th>
                <th>{{ tr(L.errors) }}</th>
                <th>{{ tr(L.agents) }}</th>
                <th>{{ tr(L.tokens) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in projects"
                :key="entry.name"
                :class="{ selected: entry.name === project }"
                @click="project = entry.name"
              >
                <td>{{ entry.name }}</td>
                <td>{{ entry.bucket.sessions }}</td>
                <td>{{ entry.bucket.events }}</td>
                <td>{{ entry.bucket.toolCalls }}</td>
                <td :class="{ bad: entry.bucket.errors > 0 }">{{ entry.bucket.errors }}</td>
                <td>{{ entry.bucket.agents }}</td>
                <td>{{ formatTokens(entry.bucket.tokensIn + entry.bucket.tokensOut) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3>{{ tr(L.topTools) }}</h3>
          <ul class="ranking">
            <li v-for="entry in tools" :key="entry.key">
              <span class="rank-key">{{ entry.key }}</span>
              <span class="rank-bar">
                <span :style="{ width: `${(entry.n / (tools[0]?.n ?? 1)) * 100}%` }" />
              </span>
              <span class="rank-n">{{ entry.n }}</span>
            </li>
          </ul>

          <h3>{{ tr(L.models) }}</h3>
          <ul class="ranking">
            <li v-for="entry in models" :key="entry.key">
              <span class="rank-key">{{ entry.key }}</span>
              <span class="rank-bar">
                <span :style="{ width: `${(entry.n / (models[0]?.n ?? 1)) * 100}%` }" />
              </span>
              <span class="rank-n">{{ entry.n }}</span>
            </li>
          </ul>

          <h3>{{ tr(L.agentTypes) }}</h3>
          <ul class="ranking">
            <li v-for="entry in agentTypes" :key="entry.key">
              <span class="rank-key">{{ entry.key }}</span>
              <span class="rank-bar">
                <span :style="{ width: `${(entry.n / (agentTypes[0]?.n ?? 1)) * 100}%` }" />
              </span>
              <span class="rank-n">{{ entry.n }}</span>
            </li>
          </ul>
        </section>
      </div>

      <p class="muted metrics-note">{{ tr(L.note) }}</p>
    </template>
  </div>
</template>
