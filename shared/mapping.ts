import type { Text } from './i18n.js'
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
  // Lanzar un subagente no es «ir a un sitio»: ocurre en la Mesa, junto a Claude, que es
  // donde nace el hijo. Sin esta línea, `Agent` caía en el Trastero (40 usos en un histórico
  // real, así que se notaba).
  Agent: 'desk',
  SendMessage: 'desk',
  Workflow: 'desk',
  // Programar algo para más tarde va con las tareas
  ScheduleWakeup: 'board',
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
  label: Text
  icon: string
  /** Posición relativa en el escenario, en unidades 0..1 (x, y). */
  x: number
  y: number
  /** Qué significa este lugar. Se muestra en la leyenda y en el tooltip. */
  help: Text
}

/**
 * Disposición del escenario. El usuario está abajo en el centro (`desk`), el resto
 * de estaciones se reparten alrededor para que los recorridos sean legibles.
 */
export const STATIONS: StationMeta[] = [
  {
    id: 'library',
    label: { es: 'Biblioteca', en: 'Library' },
    icon: '📚',
    x: 0.13,
    y: 0.18,
    help: {
      es: 'Claude lee y busca: abre ficheros, busca patrones por el proyecto o rastrea qué herramientas tiene disponibles. No modifica nada.',
      en: 'Claude reads and searches: opens files, greps the project, or looks up which tools it has. Nothing is modified here.',
    },
  },
  {
    id: 'terminal',
    label: { es: 'Terminal', en: 'Terminal' },
    icon: '⌨️',
    x: 0.4,
    y: 0.15,
    help: {
      es: 'Ejecuta comandos de shell (tests, git, builds). Es la estación con más tráfico y la única que puede tener efectos fuera del proyecto.',
      en: 'Runs shell commands (tests, git, builds). The busiest station, and the only one that can have effects outside the project.',
    },
  },
  {
    id: 'workshop',
    label: { es: 'Taller', en: 'Workshop' },
    icon: '✏️',
    x: 0.7,
    y: 0.15,
    help: {
      es: 'Aquí se escribe: crear ficheros o editarlos. El resultado muestra las líneas añadidas y quitadas (+n / −m).',
      en: 'Where writing happens: creating and editing files. The result shows added and removed lines (+n / −m).',
    },
  },
  {
    id: 'mcp',
    label: { es: 'Puestos MCP', en: 'MCP desks' },
    icon: '🔌',
    x: 0.91,
    y: 0.42,
    help: {
      es: 'Herramientas que no son de Claude Code, servidas por tus MCP (serena, ulyses-*, Atlassian…). El detalle indica el servidor y la operación.',
      en: 'Tools that are not part of Claude Code, served by your MCP servers. The detail shows the server and the operation.',
    },
  },
  {
    id: 'outside',
    label: { es: 'Exterior', en: 'Outdoors' },
    icon: '🌐',
    x: 0.9,
    y: 0.66,
    help: {
      es: 'Salidas a internet: búsquedas web y descarga de páginas. Útil para saber cuándo Claude está mirando fuera y no tu código.',
      en: 'Trips to the internet: web searches and page fetches. Handy for spotting when Claude is looking outside instead of at your code.',
    },
  },
  {
    id: 'board',
    label: { es: 'Tablón', en: 'Task board' },
    icon: '📋',
    x: 0.12,
    y: 0.66,
    help: {
      es: 'La lista de tareas de la sesión: se crean, se marcan en curso y se completan. Sirve para seguir el plan que Claude se ha trazado.',
      en: 'The session\'s task list: created, marked in progress and completed. Useful for following the plan Claude set for itself.',
    },
  },
  {
    id: 'skills',
    label: { es: 'Skills', en: 'Skills' },
    icon: '📖',
    x: 0.11,
    y: 0.42,
    help: {
      es: 'Manuales que Claude consulta para una tarea concreta (los tuyos incluidos: openspec-propose, langfuse, review-pr…). El detalle muestra el nombre y los argumentos.',
      en: 'Manuals Claude opens for a specific task, yours included. The detail shows the skill name and its arguments.',
    },
  },
  {
    id: 'worktree',
    label: { es: 'Worktrees', en: 'Worktrees' },
    icon: '🌿',
    x: 0.3,
    y: 0.9,
    help: {
      es: 'Entradas y salidas de un worktree de git: una copia aislada del repo donde trabajar sin tocar tu directorio.',
      en: 'Entering and leaving a git worktree: an isolated copy of the repo to work in without touching your directory.',
    },
  },
  {
    id: 'showcase',
    label: { es: 'Vitrina', en: 'Showcase' },
    icon: '🎨',
    x: 0.8,
    y: 0.9,
    help: {
      es: 'Lo que Claude te devuelve a ti: preguntas con opciones, planes que pide aprobar y páginas publicadas. Si hay actividad aquí, probablemente te esté esperando.',
      en: 'What Claude hands back to you: questions, plans awaiting approval, published pages. Activity here usually means it is waiting on you.',
    },
  },
  {
    id: 'unknown',
    label: { es: 'Trastero', en: 'Junk room' },
    icon: '❓',
    x: 0.9,
    y: 0.2,
    help: {
      es: 'Herramientas que todavía no tienen sitio propio en el mundo. Si ves mucho tráfico aquí, toca añadir esa herramienta a la tabla de estaciones (shared/mapping.ts) — y a partir de cuatro visitas el Trastero deja de parecer inofensivo, como el conejo de Caerbannog.',
      en: 'Tools that do not have a place of their own yet. Heavy traffic here means it is time to add them to the station table (shared/mapping.ts) — and after four visits the junk room stops looking harmless, much like the rabbit of Caerbannog.',
    },
  },
  {
    id: 'desk',
    label: { es: 'Mesa', en: 'The table' },
    icon: '🪑',
    x: 0.5,
    y: 0.52,
    help: {
      es: 'No es una estación, sino la zona central —el tablero cuadrado— donde estás tú, donde Claude piensa y habla, y donde nacen los subagentes esperando su primera tarea. Lleva grabado «aquí están reunidos los caballeros de la mesa cuadrada», que es lo que en el fondo son. No tiene cartel para no tapar a quien la cruza.',
      en: 'Not a station but the central area —the square board— where you sit, where Claude thinks and talks, and where subagents are born waiting for their first task. It is engraved with "here are gathered the knights of the square table", which is what they are, really. No signpost, so it never covers whoever walks across.',
    },
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

/**
 * Color de un subagente concreto: el tono base lo da su tipo y `variant` lo separa de sus
 * hermanos. Sin esto, dos `Explore` a la vez son dos círculos azules idénticos y no hay
 * forma de saber cuál está haciendo qué.
 */
export function colorForAgent(agentType: string | undefined, variant = 0): number {
  const base = colorForAgentType(agentType)
  if (!variant) return base
  return shiftLightness(base, variant)
}

/** Aclara u oscurece un color de forma escalonada y estable. */
function shiftLightness(color: number, variant: number): number {
  // Secuencia: +22%, −22%, +40%, −40%, … siempre el mismo tono para el mismo índice.
  const step = Math.ceil(variant / 2)
  const sign = variant % 2 === 1 ? 1 : -1
  const factor = Math.min(0.62, step * 0.22) * sign

  const channels = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
  const shifted = channels.map((value) => {
    const next = factor > 0 ? value + (255 - value) * factor : value * (1 + factor)
    return Math.max(0, Math.min(255, Math.round(next)))
  })
  return (shifted[0] << 16) | (shifted[1] << 8) | shifted[2]
}

/** Color base por tipo de subagente. */
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
