import { stationForTool } from '../../shared/mapping.js'
import { summarizeToolInput, summarizeToolResult } from './parser.js'
import type { ActorInfo, TimelineEvent } from '../../shared/types.js'

/**
 * Ingesta de los hooks HTTP de Claude Code (`{"type":"http","url":".../hook"}` en
 * ~/.claude/settings.json). Es opcional: sin hooks todo funciona leyendo los ficheros,
 * solo con algo más de latencia y sin saber que hay un permiso pendiente.
 *
 * El front deduplica contra el watcher por `toolUseId`.
 */

export interface HookPayload {
  hook_event_name?: string
  session_id?: string
  cwd?: string
  permission_mode?: string
  tool_name?: string
  tool_input?: unknown
  tool_use_id?: string
  tool_response?: unknown
  agent_id?: string
  agent_type?: string
  notification_type?: string
  message?: string
  last_assistant_message?: string
}

export interface HookResult {
  events: TimelineEvent[]
  agents: { agent: ActorInfo; state: 'spawn' | 'done' }[]
}

export function normalizeHook(payload: HookPayload): HookResult {
  const sessionId = payload.session_id
  if (!sessionId) return { events: [], agents: [] }

  const ts = new Date().toISOString()
  const tool = payload.tool_name
  const agentId = payload.agent_id ?? null
  const base = {
    parentUuid: null,
    sessionId,
    agentId,
    ts,
    tool,
    station: stationForTool(tool),
    toolUseId: payload.tool_use_id,
  }

  switch (payload.hook_event_name) {
    case 'PreToolUse':
      return {
        events: [
          {
            ...base,
            uuid: `hook:${payload.tool_use_id ?? ts}`,
            kind: tool === 'Skill' ? 'skill' : 'tool_call',
            summary: summarizeToolInput(tool ?? '?', payload.tool_input, payload.cwd),
            payload: payload.tool_input,
          },
        ],
        agents: [],
      }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return {
        events: [
          {
            ...base,
            uuid: `hook:${payload.tool_use_id ?? ts}:done`,
            kind: 'tool_result',
            summary: summarizeToolResult(tool, payload.tool_response),
            payload: payload.tool_response,
            isError: payload.hook_event_name === 'PostToolUseFailure',
          },
        ],
        agents: [],
      }
    case 'PermissionRequest':
      return {
        events: [
          {
            ...base,
            uuid: `hook:perm:${payload.tool_use_id ?? ts}`,
            kind: 'permission',
            summary: `esperando permiso: ${tool ?? '?'} ${summarizeToolInput(tool ?? '?', payload.tool_input, payload.cwd)}`,
            payload: payload.tool_input,
          },
        ],
        agents: [],
      }
    case 'SubagentStart':
    case 'SubagentStop': {
      if (!payload.agent_id) return { events: [], agents: [] }
      const agent: ActorInfo = {
        id: payload.agent_id,
        sessionId,
        kind: 'subagent',
        agentType: payload.agent_type,
        depth: 1,
      }
      const spawning = payload.hook_event_name === 'SubagentStart'
      return {
        events: [
          {
            ...base,
            uuid: `hook:${payload.agent_id}:${spawning ? 'spawn' : 'done'}`,
            kind: spawning ? 'agent_spawn' : 'agent_done',
            station: 'desk',
            summary: `${payload.agent_type ?? 'agente'} ${spawning ? 'arranca' : 'termina'}`,
            actor: agent,
          },
        ],
        agents: [{ agent, state: spawning ? 'spawn' : 'done' }],
      }
    }
    case 'Notification':
      return {
        events: [
          {
            ...base,
            uuid: `hook:notif:${ts}`,
            kind: payload.notification_type === 'permission_prompt' ? 'permission' : 'meta',
            station: 'desk',
            summary: payload.message ?? payload.notification_type ?? 'notificación',
          },
        ],
        agents: [],
      }
    default:
      return { events: [], agents: [] }
  }
}
