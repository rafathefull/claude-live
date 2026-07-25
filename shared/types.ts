/**
 * Tipos compartidos entre el servidor (lector de ~/.claude) y el mundo (front).
 *
 * IMPORTANTE: el formato de los ficheros de Claude Code es interno y puede cambiar
 * entre versiones. Todo lo que se lee de disco pasa por el parser, que es tolerante:
 * campos ausentes → undefined, tipos desconocidos → evento `meta` ignorable.
 */

/** Lugares del mundo. La tabla herramienta → estación está en `mapping.ts`. */
export type StationId =
  | 'library' // Read, Glob, Grep, ToolSearch
  | 'workshop' // Edit, Write, NotebookEdit
  | 'terminal' // Bash
  | 'mcp' // mcp__<servidor>__<tool>
  | 'outside' // WebSearch, WebFetch
  | 'board' // TaskCreate, TaskUpdate, TaskList…
  | 'skills' // Skill, slash commands
  | 'worktree' // EnterWorktree, ExitWorktree
  | 'showcase' // Artifact, AskUserQuestion, ExitPlanMode
  | 'desk' // el sitio del usuario y del propio agente cuando no trabaja
  | 'unknown'

export type EventKind =
  | 'prompt' // el usuario pide algo
  | 'thinking' // razonamiento del modelo
  | 'text' // texto visible del modelo
  | 'tool_call' // el agente se pone en marcha hacia una estación
  | 'tool_result' // vuelve con el resultado
  | 'agent_spawn' // nace un subagente
  | 'agent_done' // el subagente entrega y muere
  | 'skill' // se coge un manual del estante
  | 'permission' // esperando permiso del usuario
  | 'session_start'
  | 'session_end'
  | 'meta' // cambios de modo, títulos, etc.

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

export interface TimelineEvent {
  /** uuid del evento en el transcript; para eventos sintéticos, `<sessionId>:<n>`. */
  uuid: string
  parentUuid: string | null
  sessionId: string
  /** null = sesión principal; si no, id del subagente que lo produjo. */
  agentId: string | null
  /** ISO-8601. */
  ts: string
  kind: EventKind
  /** Nombre crudo de la herramienta (Bash, Edit, mcp__serena__find_symbol…). */
  tool?: string
  station: StationId
  /** Una línea legible, ya recortada, lista para pintar. */
  summary: string
  /** Payload truncado (ver MAX_PAYLOAD_BYTES). El íntegro: GET /api/event/:uuid/raw */
  payload?: unknown
  /** true si el payload venía recortado. */
  truncated?: boolean
  /** Emparejado tool_use.id ↔ tool_result.tool_use_id. */
  toolUseId?: string
  durationMs?: number
  isError?: boolean
  tokens?: TokenUsage
  model?: string
  /** Datos extra para el mundo: tipo y descripción del subagente, nombre de skill… */
  actor?: ActorInfo
}

/** Un habitante del mundo. */
export interface ActorInfo {
  id: string
  /**
   * Sesión a la que pertenece. Va en el propio actor y no en el mensaje que lo transporta
   * porque el front no puede deducirlo: con dos sesiones abiertas, dar por hecho que es la
   * seleccionada atribuía los subagentes a la habitación equivocada.
   */
  sessionId: string
  kind: 'user' | 'main' | 'subagent' | 'job'
  /** Explore, Plan, general-purpose, claude-code-guide… */
  agentType?: string
  /** La descripción con la que se lanzó el subagente. */
  description?: string
  /** Profundidad de anidamiento (0 = sesión principal). */
  depth: number
  parentAgentId?: string | null
}

export type SessionStatus = 'busy' | 'idle' | 'unknown' | 'dead'

/** Una sesión de Claude Code viva o histórica. */
export interface SessionInfo {
  sessionId: string
  cwd: string
  /** Último segmento del cwd, para mostrar. */
  project: string
  /** Slug del directorio en ~/.claude/projects. */
  slug: string
  transcriptPath: string
  /** Presente solo si la sesión está viva (viene del roster). */
  pid?: number
  /** Nombre derivado que se asigna Claude Code (p. ej. "rafa-d9"). */
  name?: string
  version?: string
  kind?: string
  entrypoint?: string
  status: SessionStatus
  live: boolean
  /** true si viene del daemon (sesión en background). */
  background?: boolean
  startedAt?: number
  updatedAt?: number
  /** Enriquecido desde el transcript. */
  aiTitle?: string
  gitBranch?: string
  model?: string
  permissionMode?: string
  mode?: string
  tokens?: TokenUsage
  /** Tokens de la última petición: aproxima el contexto en uso. */
  lastContextTokens?: number
  eventCount?: number
  firstTs?: string
  lastTs?: string
  sizeBytes?: number
}

/** Mensajes que el servidor empuja por SSE. */
export type ServerMessage =
  | { type: 'hello'; sessions: SessionInfo[]; agents: ActorInfo[] }
  | { type: 'event'; event: TimelineEvent }
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'agent'; agent: ActorInfo; state: 'spawn' | 'done' }
