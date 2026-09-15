import type { Lang, Text } from './i18n.js'
import type { Stat, TaskEnd } from './types.js'

/** Cómo acabó un shell o un monitor, en las dos lenguas. Lo usan la timeline y el panel. */
export const TASK_END_TEXT: Record<TaskEnd, Text> = {
  completed: { es: 'terminado', en: 'finished' },
  stopped: { es: 'parado', en: 'stopped' },
  expired: { es: 'caducado', en: 'expired' },
  failed: { es: 'falló', en: 'failed' },
}

/**
 * Da formato a un dato del servidor en el idioma activo. El parser vive en el servidor y no
 * puede saber en qué idioma mira cada cliente, así que emite el número y aquí se le pone la
 * palabra: «74 líneas» o «74 lines» salen del mismo `{ kind: 'lines', n: 74 }`.
 */
export function formatStat(stat: Stat, lang: Lang): string {
  const t = (text: Text) => text[lang]
  const plural = (n: number, one: Text, many: Text) => `${n} ${t(n === 1 ? one : many)}`

  switch (stat.kind) {
    case 'lines': {
      const count = plural(stat.n, { es: 'línea', en: 'line' }, { es: 'líneas', en: 'lines' })
      return stat.total ? `${count} ${t({ es: 'de', en: 'of' })} ${stat.total}` : count
    }
    case 'matches':
      return plural(
        stat.n,
        { es: 'coincidencia', en: 'match' },
        { es: 'coincidencias', en: 'matches' },
      )
    case 'files':
      return plural(stat.n, { es: 'fichero', en: 'file' }, { es: 'ficheros', en: 'files' })
    case 'tasks':
      return plural(stat.n, { es: 'tarea', en: 'task' }, { es: 'tareas', en: 'tasks' })
    case 'questions':
      return plural(
        stat.n,
        { es: 'pregunta', en: 'question' },
        { es: 'preguntas', en: 'questions' },
      )
    case 'diff':
      return `+${stat.added} / −${stat.removed}`
    case 'empty':
      return t({ es: 'sin salida', en: 'no output' })
    case 'stdout':
      return stat.extra > 0
        ? `${stat.head} (+${plural(stat.extra, { es: 'línea', en: 'line' }, { es: 'líneas', en: 'lines' })})`
        : stat.head
    case 'stderr':
      return `stderr: ${stat.text}`
    case 'launched':
      return `${t({ es: 'lanzado', en: 'launched' })} (${stat.id})`
    case 'chosen':
      return `${t({ es: 'elegido', en: 'chosen' })}: ${stat.value}`
    case 'taskUpdated':
      return `#${stat.id} → ${t({ es: 'actualizada', en: 'updated' })}`
    case 'fileOp':
      return `${stat.op} ${stat.path}`
    case 'waitingPermission':
      return `${t({ es: 'esperando permiso', en: 'waiting for permission' })}: ${stat.tool} ${stat.detail}`
    case 'agentState':
      return `${stat.agentType} ${
        stat.started ? t({ es: 'arranca', en: 'starts' }) : t({ es: 'termina', en: 'finishes' })
      }`
    case 'turnEnded':
      return t({ es: 'turno terminado', en: 'turn finished' })
    case 'taskStarted':
      return stat.task === 'monitor'
        ? `${t({ es: 'monitor armado', en: 'monitor armed' })} (${stat.id})`
        : `${t({ es: 'shell en segundo plano', en: 'shell in the background' })} (${stat.id})`
    case 'monitorEvent':
      return `${t({ es: 'monitor', en: 'monitor' })}: ${stat.text}`
    case 'taskEnded': {
      const who = t(
        stat.task === 'monitor' ? { es: 'monitor', en: 'monitor' } : { es: 'shell', en: 'shell' },
      )
      const how = t(TASK_END_TEXT[stat.status])
      const code = stat.exitCode !== undefined ? ` (exit ${stat.exitCode})` : ''
      return `${who} ${how}${code}`
    }
  }
}
