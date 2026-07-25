import type { StationId } from './types.js'

/**
 * Tabla única herramienta → estación del mundo. Añadir una herramienta nueva al
 * escenario debe ser una línea aquí y nada más: la usan tanto el parser (para
 * rellenar `station`) como la escena (para colocar y etiquetar los lugares).
 */
const EXACT: Record<string, StationId> = {
  // Biblioteca: leer y buscar
  Read: 'library',
  Glob: 'library',
  Grep: 'library',
  ToolSearch: 'library',
  LSP: 'library',
  // Taller: escribir
  Edit: 'workshop',
  Write: 'workshop',
  NotebookEdit: 'workshop',
  // Terminal
  Bash: 'terminal',
  BashOutput: 'terminal',
  KillShell: 'terminal',
  Monitor: 'terminal',
  // Exterior
  WebSearch: 'outside',
  WebFetch: 'outside',
  // Tablón de tareas
  TaskCreate: 'board',
  TaskUpdate: 'board',
  TaskList: 'board',
  TaskGet: 'board',
  TaskOutput: 'board',
  TaskStop: 'board',
  // Estante de skills
  Skill: 'skills',
  // Worktrees
  EnterWorktree: 'worktree',
  ExitWorktree: 'worktree',
  // Vitrina: lo que vuelve hacia el usuario
  Artifact: 'showcase',
  AskUserQuestion: 'showcase',
  ExitPlanMode: 'showcase',
  EnterPlanMode: 'showcase',
  PushNotification: 'showcase',
  ShareOnboardingGuide: 'showcase',
}

export function stationForTool(tool: string | undefined): StationId {
  if (!tool) return 'desk'
  if (tool.startsWith('mcp__')) return 'mcp'
  return EXACT[tool] ?? 'unknown'
}

/** Nombre del servidor MCP a partir del nombre de herramienta (mcp__serena__x → serena). */
export function mcpServerOf(tool: string | undefined): string | null {
  if (!tool?.startsWith('mcp__')) return null
  const rest = tool.slice(5)
  const sep = rest.indexOf('__')
  return sep === -1 ? rest : rest.slice(0, sep)
}

export interface StationMeta {
  id: StationId
  label: string
  icon: string
  /** Posición relativa en el escenario, en unidades 0..1 (x, y). */
  x: number
  y: number
  /** Qué significa este lugar. Se muestra en la leyenda. */
  help: string
}

/**
 * Disposición del escenario. El usuario está abajo en el centro (`desk`), el resto
 * de estaciones se reparten alrededor para que los recorridos sean legibles.
 */
export const STATIONS: StationMeta[] = [
  {
    id: 'library',
    label: 'Biblioteca',
    icon: '📚',
    x: 0.13,
    y: 0.18,
    help: 'Claude lee y busca: abre ficheros, busca patrones por el proyecto o rastrea qué herramientas tiene disponibles. No modifica nada.',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: '⌨️',
    x: 0.4,
    y: 0.15,
    help: 'Ejecuta comandos de shell (tests, git, builds). Es la estación con más tráfico y la única que puede tener efectos fuera del proyecto.',
  },
  {
    id: 'workshop',
    label: 'Taller',
    icon: '✏️',
    x: 0.7,
    y: 0.15,
    help: 'Aquí se escribe: crear ficheros o editarlos. El resultado muestra las líneas añadidas y quitadas (+n / −m).',
  },
  {
    id: 'mcp',
    label: 'Puestos MCP',
    icon: '🔌',
    x: 0.91,
    y: 0.42,
    help: 'Herramientas que no son de Claude Code, servidas por tus MCP (serena, ulyses-*, Atlassian…). El detalle indica el servidor y la operación.',
  },
  {
    id: 'outside',
    label: 'Exterior',
    icon: '🌐',
    x: 0.9,
    y: 0.66,
    help: 'Salidas a internet: búsquedas web y descarga de páginas. Útil para saber cuándo Claude está mirando fuera y no tu código.',
  },
  {
    id: 'board',
    label: 'Tablón',
    icon: '📋',
    x: 0.12,
    y: 0.66,
    help: 'La lista de tareas de la sesión: se crean, se marcan en curso y se completan. Sirve para seguir el plan que Claude se ha trazado.',
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: '📖',
    x: 0.11,
    y: 0.42,
    help: 'Manuales que Claude consulta para una tarea concreta (los tuyos incluidos: openspec-propose, langfuse, review-pr…). El detalle muestra el nombre y los argumentos.',
  },
  {
    id: 'worktree',
    label: 'Worktrees',
    icon: '🌿',
    x: 0.3,
    y: 0.9,
    help: 'Entradas y salidas de un worktree de git: una copia aislada del repo donde trabajar sin tocar tu directorio.',
  },
  {
    id: 'showcase',
    label: 'Vitrina',
    icon: '🎨',
    x: 0.8,
    y: 0.9,
    help: 'Lo que Claude te devuelve a ti: preguntas con opciones, planes que pide aprobar y páginas publicadas. Si hay actividad aquí, probablemente te esté esperando.',
  },
  {
    id: 'unknown',
    label: 'Trastero',
    icon: '❓',
    x: 0.9,
    y: 0.2,
    help: 'Herramientas que todavía no tienen sitio propio en el mundo. Si ves mucho tráfico aquí, toca añadir esa herramienta a la tabla de estaciones (shared/mapping.ts).',
  },
  {
    id: 'desk',
    label: 'Mesa',
    icon: '🪑',
    x: 0.5,
    y: 0.52,
    help: 'El centro de la escena: donde estás tú, donde Claude piensa y habla, y desde donde nacen los subagentes. No es una herramienta.',
  },
]

export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]))

/**
 * Herramientas que viven en una estación, calculadas invirtiendo la tabla EXACT: así la
 * leyenda nunca se queda desfasada respecto al mapeo real.
 */
export function toolsForStation(id: StationId): string[] {
  if (id === 'mcp') return ['mcp__<servidor>__<tool>']
  if (id === 'desk') return []
  if (id === 'unknown') return ['(cualquier herramienta sin estación asignada)']
  return Object.entries(EXACT)
    .filter(([, station]) => station === id)
    .map(([tool]) => tool)
}

/** Color por tipo de subagente, para que se distingan de un vistazo. */
export function colorForAgentType(agentType: string | undefined): number {
  switch (agentType) {
    case 'Explore':
      return 0x4aa3ff
    case 'Plan':
      return 0xb07cff
    case 'general-purpose':
      return 0x4ade80
    case 'claude-code-guide':
      return 0xf59e0b
    case undefined:
      return 0xe5e7eb
    default:
      return 0xfb7185
  }
}
