<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { loadMetrics } from '../store'
import {
  ALL_PROJECTS,
  activeTimeOf,
  costOf,
  formatMoney,
  series,
  top,
  totals,
  valueOf,
  yourShareOf,
  type Measure,
} from '../metrics'
import { formatDuration, formatTokens } from '../format'
import { tr } from '../i18n'
import {
  TIMING_CATEGORIES,
  TIMING_TEXT,
  timingSidesOf,
  tokensPerSecond,
  type TimingCategory,
} from '@shared/timing'
import type { Metrics, MetricsBucket } from '@shared/types'

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
  time: { es: 'tiempo activo', en: 'active time' },
  timeSplit: { es: 'En qué se fue el tiempo del rango', en: 'Where the range’s time went' },
  machine: { es: 'Claude y la máquina', en: 'Claude and the machine' },
  you: { es: 'tú', en: 'you' },
  yourShare: { es: '% tú', en: '% you' },
  yourShareTitle: {
    es: 'Qué parte del tiempo activo fue tuya: esperas, preguntas y permisos',
    en: 'How much of the active time was yours: waits, questions and permissions',
  },
  modelSpeed: {
    es: 'respuestas · tiempo medio por respuesta · tokens de salida por segundo',
    en: 'responses · mean time per response · output tokens per second',
  },
  perResponse: { es: '/resp', en: '/resp' },
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
    es: 'El trabajo se reparte por el día de cada evento, no por el de la sesión: una conversación de madrugada cuenta en los dos días. Los subagentes se cuentan por su propio transcript. El tiempo se reparte hueco a hueco con la misma regla que el panel de una sesión (cada hueco cae en el día en que empezó) y las pausas de más de 30 minutos no están: no son de nadie.',
    en: 'Work is spread by the day of each event, not of the session: a conversation past midnight counts on both days. Subagents are counted by their own transcript. Time is split gap by gap with the same rule as a session’s panel (each gap lands on the day it started) and pauses longer than 30 minutes are left out: they belong to nobody.',
  },
  cached: { es: 'de la caché', en: 'from cache' },
  reread: { es: 'releídos', en: 're-read' },
  empty: { es: 'sin actividad', en: 'no activity' },
  peak: { es: 'máximo del rango:', en: 'range peak:' },
  cost: { es: 'coste', en: 'cost' },
  noPricing: {
    es: 'No se muestra coste: con una suscripción de Claude no se paga por uso (Claude Code declara 0). Si pagas por API, pon tus tarifas en pricing.json y aparecerá una columna de coste; hay un ejemplo en docs/pricing.example.json.',
    en: 'No cost is shown: with a Claude subscription you do not pay per use (Claude Code reports 0). If you pay per API, put your rates in pricing.json and a cost column will appear; there is an example in docs/pricing.example.json.',
  },
  untariffed: {
    es: 'sin tarifa (no suman):',
    en: 'no rate (not counted):',
  },
  rates: { es: 'tarifas de', en: 'rates from' },
}

const MEASURES: { key: Measure; label: { es: string; en: string } }[] = [
  { key: 'time', label: L.time },
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
const measure = ref<Measure>('time')

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

/** Coste del rango y de cada proyecto, solo si hay tarifas configuradas. */
const cost = computed(() => costOf(sum.value, metrics.value?.pricing ?? null))
const hasPricing = computed(() => (metrics.value?.pricing ?? null) !== null)

const tools = computed(() => top(metrics.value?.tools ?? {}, 10))
const models = computed(() => top(metrics.value?.models ?? {}, 6))
const agentTypes = computed(() => top(metrics.value?.agentTypes ?? {}, 6))

/** Alto de cada barra, en porcentaje del pico del rango. */
function heightOf(value: number): string {
  return `${Math.max(value > 0 ? 3 : 0, Math.round((value / peak.value) * 100))}%`
}

/** El valor de la medida con su unidad: minutos para el tiempo, «k» para los tokens. */
function formatMeasure(value: number): string {
  if (measure.value === 'time') return formatDuration(value)
  if (measure.value === 'tokens') return formatTokens(value)
  return String(value)
}

/** Reparto del tiempo del rango, para la barra y la leyenda: solo las categorías con algo. */
const timeSplit = computed(() => {
  const active = Math.max(1, activeTimeOf(sum.value))
  return TIMING_CATEGORIES.map((category) => ({
    category,
    ms: sum.value.time?.[category] ?? 0,
    pct: Math.round((1000 * (sum.value.time?.[category] ?? 0)) / active) / 10,
  })).filter((segment) => segment.ms > 0)
})
const timeSides = computed(() => timingSidesOf(sum.value.time))
function sharePct(ms: number): number {
  return Math.round((100 * ms) / Math.max(1, activeTimeOf(sum.value)))
}
function timeOf(bucket: MetricsBucket, category: TimingCategory): number {
  return bucket.time?.[category] ?? 0
}

/** Velocidad de un modelo, si hay datos: «3.2s /resp · 41 tok/s». Vacío en mundos antiguos. */
function speedOf(model: string): string {
  const totals = metrics.value?.modelTime?.[model]
  if (!totals || totals.responses === 0) return ''
  const perResponse = formatDuration(Math.round(totals.genMs / totals.responses))
  const rate = tokensPerSecond({
    thinkingMs: totals.genMs,
    writingMs: 0,
    outputTokens: totals.outputTokens,
  })
  return `${totals.responses} · ${perResponse}${tr(L.perResponse)}${rate ? ` · ${rate.toFixed(0)} tok/s` : ''}`
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
        <span><b>{{ formatDuration(activeTimeOf(sum)) }}</b> {{ tr(L.time) }}</span>
        <span><b>{{ sum.sessions }}</b> {{ tr(L.sessions) }}</span>
        <span><b>{{ sum.prompts }}</b> {{ tr(L.prompts) }}</span>
        <span><b>{{ sum.events }}</b> {{ tr(L.events) }}</span>
        <span><b>{{ sum.toolCalls }}</b> {{ tr(L.toolCalls) }}</span>
        <span :class="{ bad: sum.errors > 0 }"><b>{{ sum.errors }}</b> {{ tr(L.errors) }}</span>
        <span><b>{{ sum.agents }}</b> {{ tr(L.agents) }}</span>
        <span><b>{{ formatTokens(sum.tokensIn + sum.tokensOut) }}</b> {{ tr(L.tokens) }}</span>
        <span><b>{{ formatTokens(sum.tokensCache) }}</b> {{ tr(L.cache) }}</span>
        <span><b>{{ formatBytes(sum.bytes) }}</b> {{ tr(L.size) }}</span>
        <span v-if="cost"><b>{{ formatMoney(cost) }}</b> {{ tr(L.cost) }}</span>
      </div>

      <p v-if="cost && cost.untariffed.length > 0" class="muted metrics-note">
        ⚠ {{ tr(L.untariffed) }} {{ cost.untariffed.join(', ') }}
      </p>

      <!-- En qué se fue el tiempo del rango: la misma barra y leyenda que el panel de una sesión. -->
      <div v-if="timeSplit.length > 0" class="metrics-time">
        <div class="metrics-time-head">
          <strong>⏱ {{ tr(L.timeSplit) }}</strong>
          <span class="timing-sides muted">
            <span>🤖 {{ tr(L.machine) }}: <strong>{{ sharePct(timeSides.machine) }}%</strong></span>
            <span>🧑 {{ tr(L.you) }}: <strong>{{ sharePct(timeSides.you) }}%</strong></span>
          </span>
        </div>
        <div class="timing-bar" role="img">
          <span
            v-for="segment in timeSplit"
            :key="segment.category"
            :class="`tm-${segment.category}`"
            :style="{ flexGrow: segment.ms }"
            :title="`${tr(TIMING_TEXT[segment.category])} · ${formatDuration(segment.ms)} · ${segment.pct}%`"
          />
        </div>
        <ul class="timing-legend">
          <li v-for="segment in timeSplit" :key="segment.category">
            <i class="swatch" :class="`tm-${segment.category}`" />
            <span class="tm-name">{{ tr(TIMING_TEXT[segment.category]) }}</span>
            <span class="tm-ms">{{ formatDuration(segment.ms) }}</span>
            <span class="tm-pct">{{ segment.pct }}%</span>
          </li>
        </ul>
      </div>

      <!-- Barras por día. Los días sin actividad se dibujan vacíos: si se saltaran, una semana
           sin tocar nada parecería una semana de trabajo seguido. Con el tiempo, cada barra se
           apila por categoría, con los mismos colores que el reparto de arriba. -->
      <div class="chart-scale muted">
        {{ tr(L.peak) }} {{ formatMeasure(peak) }}
        {{ tr(measureLabel) }}
      </div>
      <div class="chart">
        <div
          v-for="point in points"
          :key="point.day"
          class="chart-col"
          :title="`${point.day} · ${formatMeasure(valueOf(point.bucket, measure))} ${tr(measureLabel)}`"
        >
          <span
            v-if="measure === 'time'"
            class="chart-bar stacked"
            :style="{ height: heightOf(valueOf(point.bucket, measure)) }"
          >
            <span
              v-for="category in TIMING_CATEGORIES"
              :key="category"
              :class="`tm-${category}`"
              :style="{ flexGrow: timeOf(point.bucket, category) }"
            />
          </span>
          <span v-else class="chart-bar" :style="{ height: heightOf(valueOf(point.bucket, measure)) }" />
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
                <th>{{ tr(L.time) }}</th>
                <th :title="tr(L.yourShareTitle)">{{ tr(L.yourShare) }}</th>
                <th>{{ tr(L.sessions) }}</th>
                <th>{{ tr(L.events) }}</th>
                <th>{{ tr(L.toolCalls) }}</th>
                <th>{{ tr(L.errors) }}</th>
                <th>{{ tr(L.agents) }}</th>
                <th>{{ tr(L.tokens) }}</th>
                <th v-if="hasPricing">{{ tr(L.cost) }}</th>
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
                <td>{{ formatDuration(activeTimeOf(entry.bucket)) }}</td>
                <td :title="tr(L.yourShareTitle)">{{ yourShareOf(entry.bucket) }}%</td>
                <td>{{ entry.bucket.sessions }}</td>
                <td>{{ entry.bucket.events }}</td>
                <td>{{ entry.bucket.toolCalls }}</td>
                <td :class="{ bad: entry.bucket.errors > 0 }">{{ entry.bucket.errors }}</td>
                <td>{{ entry.bucket.agents }}</td>
                <td>{{ formatTokens(entry.bucket.tokensIn + entry.bucket.tokensOut) }}</td>
                <td v-if="hasPricing">
                  {{ formatMoney(costOf(entry.bucket, metrics.pricing)!) }}
                </td>
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

          <h3>{{ tr(L.models) }} <span class="muted rank-hint">· {{ tr(L.modelSpeed) }}</span></h3>
          <ul class="ranking">
            <li v-for="entry in models" :key="entry.key" :title="speedOf(entry.key)">
              <span class="rank-key">{{ entry.key }}</span>
              <span class="rank-bar">
                <span :style="{ width: `${(entry.n / (models[0]?.n ?? 1)) * 100}%` }" />
              </span>
              <span class="rank-n">{{ speedOf(entry.key) || entry.n }}</span>
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
      <p class="muted metrics-note">
        <template v-if="hasPricing">
          💰 {{ tr(L.rates) }} <code>{{ metrics.pricing?.source }}</code>
        </template>
        <template v-else>{{ tr(L.noPricing) }}</template>
      </p>
    </template>
  </div>
</template>
