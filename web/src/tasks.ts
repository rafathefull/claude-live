import type { Lang, Text } from '@shared/i18n'
import { TASK_END_TEXT } from '@shared/stats'
import type { TaskInfo, TaskKind, TaskState } from '@shared/types'

/**
 * Shells y monitores en segundo plano, del lado del front: iconos, textos y los recuentos que
 * salen en la cabecera y en el cartel de la Terminal. Vive fuera de los componentes para poder
 * probarlo en Node.
 */

export const TASK_ICON: Record<TaskKind, string> = {
  shell: '⌨️',
  monitor: '📡',
}

export const TASK_STATE_EMOJI: Record<TaskState, string> = {
  running: '🟢',
  stale: '💤',
  completed: '✅',
  failed: '❌',
  stopped: '⏹️',
  expired: '⏰',
}

export const TASK_STATE_TEXT: Record<TaskState, Text> = {
  running: { es: 'en marcha', en: 'running' },
  stale: { es: 'sin proceso detrás', en: 'no process behind it' },
  ...TASK_END_TEXT,
}

/** Sigue viva, o al menos lo dice: es lo que cuenta como «en marcha» en los recuentos. */
export function isOpenTask(task: Pick<TaskInfo, 'state'>): boolean {
  return task.state === 'running' || task.state === 'stale'
}

export interface TaskCounts {
  /** Shells que siguen corriendo. */
  shells: number
  /** Monitores que siguen armados. */
  monitors: number
  running: number
  total: number
}

export function countTasks(tasks: readonly Pick<TaskInfo, 'state' | 'kind'>[]): TaskCounts {
  const counts: TaskCounts = { shells: 0, monitors: 0, running: 0, total: tasks.length }
  for (const task of tasks) {
    if (!isOpenTask(task)) continue
    counts.running++
    if (task.kind === 'shell') counts.shells++
    else counts.monitors++
  }
  return counts
}

/**
 * El rótulo del chip y del cartel: «1 shell · 2 monitores» mientras hay algo en marcha, como el
 * pie de Claude Code; y cuántas acabaron cuando ya no queda nada corriendo.
 */
export function taskChipLabel(counts: TaskCounts, lang: Lang): string {
  const parts: string[] = []
  if (counts.shells > 0) parts.push(`${counts.shells} shell${counts.shells === 1 ? '' : 's'}`)
  if (counts.monitors > 0) {
    const word = lang === 'es' ? (counts.monitors === 1 ? 'monitor' : 'monitores') : counts.monitors === 1 ? 'monitor' : 'monitors'
    parts.push(`${counts.monitors} ${word}`)
  }
  if (parts.length > 0) return parts.join(' · ')
  if (lang === 'es') return `${counts.total} ${counts.total === 1 ? 'terminada' : 'terminadas'}`
  return `${counts.total} finished`
}

/**
 * La versión compacta para el cartel de la Terminal, donde el texto largo pisaría el contador de
 * usos: «⌨️1 📡2» mientras corre algo, «✓3» cuando todo acabó.
 */
export function taskBadgeLabel(counts: TaskCounts): string {
  const parts: string[] = []
  if (counts.shells > 0) parts.push(`${TASK_ICON.shell}${counts.shells}`)
  if (counts.monitors > 0) parts.push(`${TASK_ICON.monitor}${counts.monitors}`)
  if (parts.length > 0) return parts.join(' ')
  return counts.total > 0 ? `✓${counts.total}` : ''
}

/** Cuánto lleva (o llevó) corriendo, en ms. */
export function runtimeOf(task: Pick<TaskInfo, 'startedAt' | 'endedAt'>, nowMs: number): number {
  const started = Date.parse(task.startedAt)
  if (!Number.isFinite(started)) return 0
  const ended = task.endedAt ? Date.parse(task.endedAt) : nowMs
  return Math.max(0, (Number.isFinite(ended) ? ended : nowMs) - started)
}

/** Primera línea con chicha de un comando, para el rótulo: los `cd` y las variables no cuentan. */
export function firstLine(command: string): string {
  const lines = command.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.find((line) => !/^(cd |export |[A-Z_]+=)/.test(line)) ?? lines[0] ?? ''
}
