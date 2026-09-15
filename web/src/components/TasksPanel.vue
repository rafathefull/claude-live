<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentTasks, loadTaskOutput } from '../store'
import type { TaskOutput } from '../backend'
import { formatDuration, formatTime } from '../format'
import { tr } from '../i18n'
import { TASK_ICON, TASK_STATE_EMOJI, TASK_STATE_TEXT, firstLine, isOpenTask, runtimeOf } from '../tasks'
import type { TaskInfo } from '@shared/types'

/**
 * Los shells y monitores en segundo plano de la sesión, desplegados sobre el escenario al
 * pulsar el cartel de la Terminal o el chip de la cabecera.
 *
 * Es lo que enseña Claude Code al pulsar «1 shell» en su pie: estado, cuánto lleva, el comando y
 * su salida. Aquí sin botón de parar: el visor solo mira.
 */

const L = {
  title: { es: 'Terminal · en segundo plano', en: 'Terminal · in the background' },
  subtitle: {
    es: 'shells y monitores de esta sesión · pulsa uno para ver su salida',
    en: 'background shells and monitors of this session · click one to see its output',
  },
  empty: {
    es: 'Ningún shell ni monitor en segundo plano en esta sesión.',
    en: 'No background shell or monitor in this session.',
  },
  close: { es: 'Cerrar', en: 'Close' },
  started: { es: 'desde', en: 'since' },
  events: { es: 'eventos', en: 'events' },
  event: { es: 'evento', en: 'event' },
  timeout: { es: 'caduca a los', en: 'expires after' },
  output: { es: 'Salida', en: 'Output' },
  noOutput: {
    es: 'Sin salida todavía: Claude Code crea el fichero con el primer byte que escribe el proceso.',
    en: 'No output yet: Claude Code creates the file with the first byte the process writes.',
  },
  emptyOutput: { es: '(vacío)', en: '(empty)' },
  truncated: { es: 'solo la cola', en: 'tail only' },
  loading: { es: 'leyendo…', en: 'reading…' },
  staleNote: {
    es: 'se declara en marcha, pero no hay ningún proceso hijo de la sesión que lo respalde',
    en: 'declared running, but no child process of the session backs it',
  },
  monitorHint: {
    es: 'monitor: cada línea que escribe despierta a Claude',
    en: 'monitor: every line it writes wakes Claude',
  },
  shellHint: {
    es: 'shell: corre hasta que termina y entonces avisa',
    en: 'shell: runs until it exits, then notifies',
  },
}

const emit = defineEmits<{ (e: 'close'): void }>()

const tasks = currentTasks

/** Reloj del panel: el tiempo corriendo se actualiza cada segundo mientras está abierto. */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
/** Cuánto se espera entre lecturas de la salida de una tarea que sigue corriendo. */
const OUTPUT_REFRESH_MS = 3000
let refresher: ReturnType<typeof setInterval> | undefined

/** La tarea cuya salida está desplegada. */
const openId = ref<string | null>(null)
const output = ref<TaskOutput | null>(null)
const loading = ref(false)

const openTask = computed(() => tasks.value.find((task) => task.id === openId.value) ?? null)

async function fetchOutput(): Promise<void> {
  const task = openTask.value
  if (!task) return
  loading.value = true
  try {
    const next = await loadTaskOutput(task.sessionId, task.id)
    // Si mientras tanto se cerró o se cambió de tarea, esta lectura ya no interesa.
    if (openId.value === task.id) output.value = next
  } finally {
    loading.value = false
  }
}

function toggle(task: TaskInfo): void {
  if (openId.value === task.id) {
    openId.value = null
    output.value = null
    return
  }
  openId.value = task.id
  output.value = null
  void fetchOutput()
}

// La salida de una tarea viva crece: se relee cada pocos segundos y cuando el servidor dice
// que el fichero ha cambiado de tamaño.
watch(
  () => openTask.value?.outputBytes,
  () => void fetchOutput(),
)

onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 1000)
  refresher = setInterval(() => {
    if (openTask.value && isOpenTask(openTask.value) && !loading.value) void fetchOutput()
  }, OUTPUT_REFRESH_MS)
})

onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
  if (refresher) clearInterval(refresher)
})

function runtime(task: TaskInfo): string {
  return formatDuration(runtimeOf(task, now.value))
}

function name(task: TaskInfo): string {
  return task.description || firstLine(task.command) || task.id
}

function bytes(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`
}
</script>

<template>
  <aside class="jobs-banner tasks-panel">
    <header>
      <span class="banner-icon">⌨️</span>
      <strong>{{ tr(L.title) }}</strong>
      <span class="muted">{{ tr(L.subtitle) }}</span>
      <button :title="tr(L.close)" @click="emit('close')">✕</button>
    </header>

    <p v-if="tasks.length === 0" class="muted banner-empty">{{ tr(L.empty) }}</p>

    <ul v-else>
      <template v-for="task in tasks" :key="task.id">
        <li
          :class="[task.state, { open: openId === task.id }]"
          :title="tr(task.kind === 'monitor' ? L.monitorHint : L.shellHint)"
          @click="toggle(task)"
        >
          <span class="job-icon">{{ TASK_ICON[task.kind] }}</span>
          <span class="job-main">
            <span class="job-name">{{ name(task) }}</span>
            <span v-if="task.description && task.command" class="job-said mono">
              {{ firstLine(task.command) }}
            </span>
            <span v-if="task.lastEvent" class="job-said">📡 {{ task.lastEvent }}</span>
          </span>
          <span class="job-meta">
            <span class="job-state">
              {{ TASK_STATE_EMOJI[task.state] }} {{ tr(TASK_STATE_TEXT[task.state]) }}
              <span v-if="task.exitCode !== undefined" class="muted">· exit {{ task.exitCode }}</span>
            </span>
            <span class="muted">
              {{ runtime(task) }} · {{ tr(L.started) }} {{ formatTime(task.startedAt) }}
              <template v-if="task.kind === 'monitor'">
                · {{ task.events }} {{ tr(task.events === 1 ? L.event : L.events) }}
              </template>
              <template v-if="task.timeoutMs && isOpenTask(task)">
                · {{ tr(L.timeout) }} {{ formatDuration(task.timeoutMs) }}
              </template>
            </span>
          </span>
        </li>

        <li v-if="openId === task.id" class="task-output">
          <div class="task-out-head">
            <strong>{{ tr(L.output) }}</strong>
            <span v-if="loading && !output">{{ tr(L.loading) }}</span>
            <template v-else-if="output?.exists">
              <span>{{ bytes(output.size) }}</span>
              <span v-if="output.truncated">· {{ tr(L.truncated) }}</span>
            </template>
            <span class="mono path">{{ task.outputPath }}</span>
          </div>
          <p v-if="output && !output.exists" class="muted">{{ tr(L.noOutput) }}</p>
          <pre v-else-if="output" class="task-out">{{ output.text || tr(L.emptyOutput) }}</pre>
        </li>
      </template>
    </ul>

    <p v-if="tasks.some((task) => task.state === 'stale')" class="muted banner-note">
      💤 {{ tr(L.staleNote) }}
    </p>
  </aside>
</template>
