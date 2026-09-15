/**
 * Pruebas del store del front sin navegador: se le aplican mensajes del servidor tal como
 * llegarían por SSE y se comprueba el estado resultante.
 *
 * Cubre los dos fallos que se colaban en silencio: eventos duplicados al reconectar y
 * subagentes atribuidos a la sesión equivocada cuando hay dos abiertas.
 *
 *   npm run test:store
 */
import { applyServerMessage, currentAgents, currentEvents, currentTasks, state } from '../src/store.js'
import { countTasks, taskBadgeLabel, taskChipLabel } from '../src/tasks.js'
import type { ActorInfo, ServerMessage, SessionInfo, TaskInfo, TimelineEvent } from '../../shared/types.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

const SESSION_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const SESSION_B = 'bbbbbbbb-0000-4000-8000-000000000002'

function session(id: string, project: string): SessionInfo {
  return {
    sessionId: id,
    cwd: `/home/demo/${project}`,
    project,
    slug: `-home-demo-${project}`,
    transcriptPath: `/tmp/${id}.jsonl`,
    status: 'busy',
    live: true,
  }
}

/** Un evento de pensamiento: el caso crítico, porque no tiene toolUseId. */
function thinking(sessionId: string, uuid: string): TimelineEvent {
  return {
    uuid,
    parentUuid: null,
    sessionId,
    agentId: null,
    ts: '2026-07-25T10:00:00.000Z',
    kind: 'thinking',
    station: 'desk',
    summary: 'me lo estoy pensando',
  }
}

function toolCall(sessionId: string, uuid: string, toolUseId: string): TimelineEvent {
  return {
    uuid,
    parentUuid: null,
    sessionId,
    agentId: null,
    ts: '2026-07-25T10:00:01.000Z',
    kind: 'tool_call',
    tool: 'Bash',
    station: 'terminal',
    summary: 'npm test',
    toolUseId,
  }
}

function agent(id: string, sessionId: string, agentType: string): ActorInfo {
  return { id, sessionId, kind: 'subagent', agentType, depth: 1 }
}

const feed = (message: ServerMessage) => applyServerMessage(message)

// ---------------------------------------------------------------- reconexión

console.log('reconexión del SSE')
feed({ type: 'hello', sessions: [session(SESSION_A, 'tienda-api')], agents: [], jobs: [] })
check(state.selectedSessionId === SESSION_A, 'la sesión viva queda seleccionada')

const stream: TimelineEvent[] = [
  thinking(SESSION_A, 'u-1'),
  toolCall(SESSION_A, 'u-2', 'toolu_1'),
  thinking(SESSION_A, 'u-3'),
]
for (const event of stream) feed({ type: 'event', event })
const afterFirst = currentEvents.value.length
check(afterFirst === 3, `llegan los 3 eventos (${afterFirst})`)

// El servidor reenvía su buffer reciente al reconectar: no debe duplicar nada.
feed({ type: 'hello', sessions: [session(SESSION_A, 'tienda-api')], agents: [], jobs: [] })
for (const event of stream) feed({ type: 'event', event })
const afterReconnect = currentEvents.value.length
check(afterReconnect === 3, `tras reconectar siguen siendo 3 (${afterReconnect})`)

// Y un evento nuevo sí entra.
feed({ type: 'event', event: thinking(SESSION_A, 'u-4') })
check(currentEvents.value.length === 4, 'un evento nuevo sí se añade')

// Un hook y el transcript describen la misma llamada con uuid distinto: cuenta una sola vez.
feed({ type: 'event', event: toolCall(SESSION_A, 'hook:toolu_9', 'toolu_9') })
const beforeTwin = currentEvents.value.length
feed({ type: 'event', event: toolCall(SESSION_A, 'u-9', 'toolu_9') })
check(
  currentEvents.value.length === beforeTwin,
  'el mismo tool_use_id por dos vías no se duplica',
)

// ---------------------------------------------------------------- multi-sesión

console.log('\ndos sesiones abiertas')
feed({
  type: 'sessions',
  sessions: [session(SESSION_A, 'tienda-api'), session(SESSION_B, 'facturacion')],
})
check(state.sessions.length === 2, 'las dos sesiones están en el estado')
check(state.selectedSessionId === SESSION_A, 'la selección no cambia sola')

// Un subagente de la sesión NO seleccionada: antes se le asignaba la sesión visible.
feed({ type: 'agent', agent: agent('agent-b1', SESSION_B, 'Explore'), state: 'spawn' })
check(
  state.agents['agent-b1']?.sessionId === SESSION_B,
  'el subagente se queda en la sesión que lo lanzó',
)
check(
  currentAgents.value.every((a) => a.id !== 'agent-b1'),
  'no aparece en la habitación de la otra sesión',
)

feed({ type: 'agent', agent: agent('agent-a1', SESSION_A, 'Plan'), state: 'spawn' })
check(
  currentAgents.value.some((a) => a.id === 'agent-a1' && a.agentType === 'Plan'),
  'el de la sesión seleccionada sí aparece, con su tipo',
)

// Al cambiar de habitación se ve el otro y no el primero.
state.selectedSessionId = SESSION_B
check(
  currentAgents.value.length === 1 && currentAgents.value[0].id === 'agent-b1',
  'cada habitación muestra solo sus actores',
)

// Los eventos también quedan separados por sesión.
feed({ type: 'event', event: thinking(SESSION_B, 'b-1') })
check(currentEvents.value.length === 1, 'la sesión B tiene su propia timeline')

// ---------------------------------------------------------------- shells y monitores

console.log('\nshells y monitores en segundo plano')

function task(id: string, sessionId: string, kind: TaskInfo['kind'], state: TaskInfo['state']): TaskInfo {
  return {
    id,
    sessionId,
    kind,
    state,
    command: kind === 'shell' ? 'PORT=3305 pnpm run start:local' : 'tail -f app.log',
    startedAt: '2026-07-25T10:00:00.000Z',
    events: 0,
    alive: state === 'running',
  }
}

// Al reconectar, el saludo trae las de todas las sesiones y sustituye lo que hubiera.
feed({
  type: 'hello',
  sessions: [session(SESSION_A, 'tienda-api'), session(SESSION_B, 'facturacion')],
  agents: [],
  jobs: [],
  tasks: [task('t-a1', SESSION_A, 'shell', 'running'), task('t-b1', SESSION_B, 'monitor', 'running')],
})
state.selectedSessionId = SESSION_A
check(
  currentTasks.value.length === 1 && currentTasks.value[0].id === 't-a1',
  'cada habitación enseña solo sus propias tareas',
)

// Un mensaje `tasks` es la lista completa de esa sesión: no se acumula.
feed({
  type: 'tasks',
  sessionId: SESSION_A,
  tasks: [task('t-a1', SESSION_A, 'shell', 'completed'), task('t-a2', SESSION_A, 'monitor', 'running')],
})
check(currentTasks.value.length === 2, 'el mensaje de tareas sustituye la lista de su sesión')
check(currentTasks.value.find((t) => t.id === 't-a1')?.state === 'completed', 'y trae el estado nuevo')

const counts = countTasks(currentTasks.value)
check(counts.running === 1 && counts.monitors === 1 && counts.shells === 0, 'el recuento solo cuenta lo que sigue en marcha')
check(taskChipLabel(counts, 'es') === '1 monitor', `el chip dice «${taskChipLabel(counts, 'es')}»`)
check(
  taskChipLabel(countTasks([task('x', SESSION_A, 'shell', 'running'), task('y', SESSION_A, 'shell', 'stale'), task('z', SESSION_A, 'monitor', 'running')]), 'en') ===
    '2 shells · 1 monitor',
  'y en inglés, con plurales: «2 shells · 1 monitor»',
)
check(
  taskChipLabel(countTasks([task('x', SESSION_A, 'shell', 'completed')]), 'es') === '1 terminada',
  'sin nada en marcha, dice cuántas acabaron',
)
check(
  taskBadgeLabel(countTasks([task('x', SESSION_A, 'shell', 'running'), task('z', SESSION_A, 'monitor', 'running')])) === '⌨️1 📡1' &&
    taskBadgeLabel(countTasks([task('x', SESSION_A, 'shell', 'completed')])) === '✓1' &&
    taskBadgeLabel(countTasks([])) === '',
  'el cartel de la Terminal usa la forma compacta con iconos',
)

// Un saludo antiguo sin tareas (la demostración publicada) no rompe nada.
feed({ type: 'hello', sessions: [session(SESSION_A, 'tienda-api')], agents: [], jobs: [] })
check(currentTasks.value.length === 0, 'un saludo sin tareas deja la lista vacía')

// Y la sesión que desaparece se lleva las suyas.
feed({ type: 'tasks', sessionId: SESSION_B, tasks: [task('t-b1', SESSION_B, 'monitor', 'running')] })
feed({ type: 'sessions', sessions: [session(SESSION_A, 'tienda-api')] })
check(state.tasks[SESSION_B] === undefined, 'las tareas de una sesión cerrada se van con ella')

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} comprobación(es) fallida(s)`)
process.exit(failures === 0 ? 0 : 1)
