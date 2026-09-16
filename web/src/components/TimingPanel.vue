<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentTasks, isReplaying, loadTiming, selectedSession, state } from '../store'
import { formatDate, formatDuration, formatTime, shortTool } from '../format'
import { tr } from '../i18n'
import { TASK_ICON, isOpenTask, runtimeOf } from '../tasks'
import {
  computeTiming,
  DEFAULT_PAUSE_MS,
  TIMING_CATEGORIES,
  TIMING_TEXT,
  timingSides,
  tokensPerSecond,
  type SlowCall,
  type TimingCategory,
  type TimingReport,
} from '@shared/timing'
import { formatTokens } from '../format'

/**
 * En qué se va el tiempo de la sesión seleccionada.
 *
 * El reparto lo hace `shared/timing.ts`. De dónde salen los eventos depende de la situación: en
 * una reproducción, de lo reproducido hasta el momento (la barra se llena con la película); en
 * vivo o en el histórico, del servidor, que tiene la conversación entera. Mientras el servidor
 * contesta se enseña lo que hay cargado, marcado como parcial.
 */

const L = {
  title: { es: 'Tiempos', en: 'Time' },
  subtitle: {
    es: 'en qué se ha ido el tiempo de esta sesión',
    en: 'where this session’s time went',
  },
  close: { es: 'Cerrar', en: 'Close' },
  active: { es: 'activo', en: 'active' },
  paused: { es: 'apartado en pausas', en: 'set aside as pauses' },
  pauseOf: { es: 'huecos de más de', en: 'gaps longer than' },
  turns: { es: 'mensajes tuyos', en: 'your messages' },
  calls: { es: 'llamadas', en: 'calls' },
  partial: {
    es: 'parcial: solo lo cargado hasta ahora',
    en: 'partial: only what is loaded so far',
  },
  replayNote: {
    es: 'hasta el punto actual de la reproducción',
    en: 'up to the current point of the replay',
  },
  machine: { es: 'Claude y la máquina', en: 'Claude and the machine' },
  you: { es: 'tú', en: 'you' },
  byTool: { es: 'Por herramienta', en: 'By tool' },
  tool: { es: 'herramienta', en: 'tool' },
  total: { es: 'total', en: 'total' },
  mean: { es: 'media', en: 'mean' },
  max: { es: 'máx.', en: 'max' },
  slowest: { es: 'Las llamadas más largas', en: 'The longest calls' },
  slowestHint: {
    es: 'pulsa una para verla en la timeline y el inspector',
    en: 'click one to see it in the timeline and the inspector',
  },
  notLoaded: {
    es: 'esta llamada no está en la parte cargada de la timeline',
    en: 'this call is not in the loaded part of the timeline',
  },
  agents: { es: 'Subagentes, en paralelo', en: 'Subagents, in parallel' },
  agentsHint: {
    es: 'su propio tiempo de trabajo, del primer evento al último; no entra en el reparto',
    en: 'their own working time, first event to last; not part of the split',
  },
  tasks: { es: 'Shells y monitores en segundo plano', en: 'Background shells and monitors' },
  models: { es: 'Por modelo', en: 'By model' },
  modelsHint: {
    es: 'cuánto tardó cada modelo en responder y a qué velocidad escribió',
    en: 'how long each model took to respond and how fast it wrote',
  },
  responses: { es: 'respuestas', en: 'responses' },
  perResponse: { es: 'por respuesta', en: 'per response' },
  outTokens: { es: 'tokens de salida', en: 'output tokens' },
  tokPerSec: { es: 'tok/s', en: 'tok/s' },
  empty: {
    es: 'Todavía no hay dos eventos entre los que medir nada.',
    en: 'Not two events yet to measure anything between.',
  },
  limits: {
    es: 'Sin hooks, una espera de permiso queda dentro del tiempo de la herramienta; con el hook PermissionRequest se separa en directo. Los huecos largos no se atribuyen a nadie: se apartan como pausas.',
    en: 'Without hooks, a permission wait hides inside the tool’s time; with the PermissionRequest hook it is split in real time. Long gaps are attributed to nobody: they are set aside as pauses.',
  },
  pauseLabel: { es: 'umbral de pausa', en: 'pause threshold' },
  minutes: { es: 'min', en: 'min' },
}

const emit = defineEmits<{ (e: 'close'): void }>()

const session = selectedSession
/** Umbral de pausa, en minutos. Ajustable porque es una convención, no un dato. */
const pauseMinutes = ref(DEFAULT_PAUSE_MS / 60_000)
const pauseMs = computed(() => Math.max(1, pauseMinutes.value) * 60_000)

const remote = ref<TimingReport | null>(null)
const loading = ref(false)
let refresher: ReturnType<typeof setInterval> | undefined
const REFRESH_MS = 10_000

/** Lo que hay cargado en el front, acotado al punto del reproductor si lo hay. */
const loadedEvents = computed(() => {
  const id = state.selectedSessionId
  if (!id) return []
  const all = state.events[id] ?? []
  return isReplaying.value ? all.slice(0, state.replay.index) : all
})

const local = computed(() => computeTiming(loadedEvents.value, { pauseMs: pauseMs.value, partial: true }))

/** En replay manda lo reproducido; si no, el servidor, y lo local mientras no conteste. */
const report = computed<TimingReport>(() => {
  if (isReplaying.value) return local.value
  return remote.value ?? local.value
})

async function fetchRemote(): Promise<void> {
  const current = session.value
  if (!current || isReplaying.value) return
  loading.value = true
  try {
    const next = await loadTiming(current.sessionId, pauseMs.value)
    if (session.value?.sessionId === current.sessionId) remote.value = next
  } finally {
    loading.value = false
  }
}

watch(
  () => [state.selectedSessionId, pauseMs.value, isReplaying.value] as const,
  () => {
    remote.value = null
    void fetchRemote()
  },
  { immediate: true },
)

onMounted(() => {
  refresher = setInterval(() => {
    if (session.value?.live && !isReplaying.value && !loading.value) void fetchRemote()
  }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (refresher) clearInterval(refresher)
})

const active = computed(() => Math.max(1, report.value.activeMs))
function pct(ms: number): number {
  return Math.round((1000 * ms) / active.value) / 10
}
const segments = computed(() =>
  TIMING_CATEGORIES.map((category) => ({
    category,
    ms: report.value.categories[category],
    pct: pct(report.value.categories[category]),
  })).filter((segment) => segment.ms > 0),
)
const sides = computed(() => timingSides(report.value))

function label(category: TimingCategory): string {
  return tr(TIMING_TEXT[category])
}

/** Selecciona la llamada en la timeline y el inspector, si está cargada. */
function reveal(call: SlowCall): void {
  const found = loadedEvents.value.find((event) => event.uuid === call.uuid)
  if (found) state.selectedEvent = found
}
function isLoaded(call: SlowCall): boolean {
  return loadedEvents.value.some((event) => event.uuid === call.uuid)
}

/** El reloj solo hace falta para los shells y monitores que siguen corriendo. */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})
</script>

<template>
  <aside class="jobs-banner timing-panel">
    <header>
      <span class="banner-icon">⏱</span>
      <strong>{{ tr(L.title) }}</strong>
      <span class="muted">{{ session?.project }} · {{ tr(L.subtitle) }}</span>
      <label class="pause-control muted">
        {{ tr(L.pauseLabel) }}
        <input v-model.number="pauseMinutes" type="number" min="1" max="1440" step="5" />
        {{ tr(L.minutes) }}
      </label>
      <button :title="tr(L.close)" @click="emit('close')">✕</button>
    </header>

    <div class="timing-body">
      <p v-if="report.activeMs === 0" class="muted banner-empty">{{ tr(L.empty) }}</p>

      <template v-else>
        <p class="timing-summary">
          <strong>{{ formatDuration(report.activeMs) }}</strong> {{ tr(L.active) }}
          <span v-if="report.firstTs && report.lastTs" class="muted">
            · {{ formatDate(report.firstTs) }} → {{ formatDate(report.lastTs) }}
          </span>
          <span class="muted">· {{ report.turns }} {{ tr(L.turns) }} · {{ report.calls }} {{ tr(L.calls) }}</span>
          <span v-if="report.pauses > 0" class="muted">
            · {{ formatDuration(report.pausedMs) }} {{ tr(L.paused) }} ({{ report.pauses }} {{ tr(L.pauseOf) }}
            {{ pauseMinutes }} {{ tr(L.minutes) }})
          </span>
          <span v-if="isReplaying" class="partial-tag">{{ tr(L.replayNote) }}</span>
          <span v-else-if="report.partial" class="partial-tag">{{ tr(L.partial) }}</span>
        </p>

        <!-- La barra: cada categoría con su ancho, en el orden de la tabla. -->
        <div class="timing-bar" role="img">
          <span
            v-for="segment in segments"
            :key="segment.category"
            :class="`tm-${segment.category}`"
            :style="{ flexGrow: segment.ms }"
            :title="`${label(segment.category)} · ${formatDuration(segment.ms)} · ${segment.pct}%`"
          />
        </div>

        <div class="timing-sides muted">
          <span>🤖 {{ tr(L.machine) }}: <strong>{{ pct(sides.machine) }}%</strong></span>
          <span>🧑 {{ tr(L.you) }}: <strong>{{ pct(sides.you) }}%</strong></span>
        </div>

        <ul class="timing-legend">
          <li v-for="segment in segments" :key="segment.category">
            <i class="swatch" :class="`tm-${segment.category}`" />
            <span class="tm-name">{{ label(segment.category) }}</span>
            <span class="tm-ms">{{ formatDuration(segment.ms) }}</span>
            <span class="tm-pct">{{ segment.pct }}%</span>
          </li>
        </ul>

        <div class="timing-columns">
          <section v-if="report.tools.length > 0">
            <h4>{{ tr(L.byTool) }}</h4>
            <table>
              <thead>
                <tr>
                  <th>{{ tr(L.tool) }}</th>
                  <th class="num">{{ tr(L.calls) }}</th>
                  <th class="num">{{ tr(L.total) }}</th>
                  <th class="num">{{ tr(L.mean) }}</th>
                  <th class="num">{{ tr(L.max) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.tools.slice(0, 10)" :key="row.tool">
                  <td class="mono">{{ shortTool(row.tool) }}</td>
                  <td class="num">{{ row.calls }}</td>
                  <td class="num">{{ formatDuration(row.totalMs) }}</td>
                  <td class="num">{{ formatDuration(Math.round(row.totalMs / row.calls)) }}</td>
                  <td class="num">{{ formatDuration(row.maxMs) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="report.slowest.length > 0">
            <h4>{{ tr(L.slowest) }} <span class="muted">· {{ tr(L.slowestHint) }}</span></h4>
            <ul class="slow-list">
              <li
                v-for="call in report.slowest"
                :key="call.uuid"
                :class="{ unloaded: !isLoaded(call) }"
                :title="isLoaded(call) ? call.summary : tr(L.notLoaded)"
                @click="reveal(call)"
              >
                <span class="tm-ms">{{ formatDuration(call.ms) }}</span>
                <span class="tool mono">{{ shortTool(call.tool) }}</span>
                <span class="muted time">{{ formatTime(call.ts) }}</span>
                <span class="summary">{{ call.summary }}</span>
              </li>
            </ul>
          </section>
        </div>

        <section v-if="report.models.length > 0">
          <h4>{{ tr(L.models) }} <span class="muted">· {{ tr(L.modelsHint) }}</span></h4>
          <table>
            <thead>
              <tr>
                <th>{{ tr(L.models).toLowerCase() }}</th>
                <th class="num">{{ tr(L.responses) }}</th>
                <th class="num">{{ label('thinking') }}</th>
                <th class="num">{{ label('writing') }}</th>
                <th class="num">{{ tr(L.perResponse) }}</th>
                <th class="num">{{ tr(L.outTokens) }}</th>
                <th class="num">{{ tr(L.tokPerSec) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.models" :key="row.model">
                <td class="mono">{{ row.model }}</td>
                <td class="num">{{ row.responses }}</td>
                <td class="num">{{ formatDuration(row.thinkingMs) }}</td>
                <td class="num">{{ formatDuration(row.writingMs) }}</td>
                <td class="num">
                  {{ row.responses ? formatDuration(Math.round((row.thinkingMs + row.writingMs) / row.responses)) : '—' }}
                </td>
                <td class="num">{{ formatTokens(row.outputTokens) }}</td>
                <td class="num">{{ tokensPerSecond(row)?.toFixed(1) ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="report.agents.length > 0">
          <h4>{{ tr(L.agents) }} <span class="muted">· {{ tr(L.agentsHint) }}</span></h4>
          <ul class="slow-list">
            <li v-for="agent in report.agents" :key="agent.id" class="static">
              <span class="tm-ms">{{ formatDuration(agent.ms) }}</span>
              <span class="tool">{{ agent.agentType ?? 'agent' }}</span>
              <span class="summary">{{ agent.description ?? agent.id }}</span>
              <span class="muted">{{ agent.events }} ev.</span>
            </li>
          </ul>
        </section>

        <section v-if="currentTasks.length > 0 && !isReplaying">
          <h4>{{ tr(L.tasks) }}</h4>
          <ul class="slow-list">
            <li v-for="task in currentTasks" :key="task.id" class="static">
              <span class="tm-ms">{{ formatDuration(runtimeOf(task, now)) }}</span>
              <span class="tool">{{ TASK_ICON[task.kind] }} {{ isOpenTask(task) ? '🟢' : '' }}</span>
              <span class="summary">{{ task.description || task.command }}</span>
            </li>
          </ul>
        </section>

        <p class="muted banner-note">{{ tr(L.limits) }}</p>
      </template>
    </div>
  </aside>
</template>
