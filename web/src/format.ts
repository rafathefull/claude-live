import { STATION_BY_ID, colorForAgentType } from '@shared/mapping'
import type { EventKind, TimelineEvent } from '@shared/types'

/**
 * Límite de contexto. Los modelos con sufijo `[1m]` llevan ventana de 1M, pero el
 * transcript guarda el id sin el sufijo (`claude-opus-5`), así que el nombre no basta: si
 * se han visto más tokens de los que caben en 200k, la ventana es necesariamente la grande.
 */
export function contextLimitFor(model: string | undefined, observedTokens = 0): number {
  if (model && /\[1m\]/.test(model)) return 1_000_000
  return observedTokens > 200_000 ? 1_000_000 : 200_000
}

export function contextPercent(session: { model?: string; lastContextTokens?: number }): number {
  const used = session.lastContextTokens ?? 0
  if (!used) return 0
  return Math.min(100, Math.round((used / contextLimitFor(session.model, used)) * 100))
}

export function formatTokens(n: number | undefined): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

export function formatTime(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-ES', { hour12: false })
}

export function formatDate(ts: string | undefined): string {
  if (!ts) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const KIND_ICON: Record<EventKind, string> = {
  prompt: '🧑',
  thinking: '💭',
  text: '💬',
  tool_call: '→',
  tool_result: '←',
  agent_spawn: '✨',
  agent_done: '✓',
  skill: '📖',
  permission: '❗',
  session_start: '▶',
  session_end: '■',
  meta: '·',
}

export function iconFor(event: TimelineEvent): string {
  if (event.kind === 'tool_call' || event.kind === 'tool_result') {
    return STATION_BY_ID.get(event.station)?.icon ?? '·'
  }
  return KIND_ICON[event.kind] ?? '·'
}

export function agentColorCss(agentType: string | undefined): string {
  return `#${colorForAgentType(agentType).toString(16).padStart(6, '0')}`
}

/** Nombre corto de la herramienta: mcp__serena__find_symbol → serena·find_symbol */
export function shortTool(tool: string | undefined): string {
  if (!tool) return ''
  if (!tool.startsWith('mcp__')) return tool
  const rest = tool.slice(5)
  const sep = rest.indexOf('__')
  return sep === -1 ? rest : `${rest.slice(0, sep)}·${rest.slice(sep + 2)}`
}
