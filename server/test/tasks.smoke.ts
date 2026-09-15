/**
 * Pruebas de los shells y monitores en segundo plano.
 *
 * Lo que aquí se rompe en silencio: que un `Bash` con run_in_background se resuma como «sin
 * salida» (el comando sigue corriendo), que la misma `<task-notification>` cuente dos veces (llega
 * encolada y entregada), que una tarea de un proceso anterior se dé por viva tras un --resume, y
 * que el marcador final del `.output` no cierre la tarea.
 *
 *   npm run test:tasks
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// La base de los ficheros de salida se fija antes de cargar el módulo, que la lee al importarse.
const base = await mkdtemp(join(tmpdir(), 'claude-live-tasks-'))
process.env.CLAUDE_LIVE_TASKS_DIR = base

const { TranscriptParser, describeToolResult } = await import('../src/parser.js')
const {
  TaskTracker,
  canInspectProcesses,
  endMarkerOf,
  matchProcess,
  outputPathFor,
  parseTaskNotifications,
  updateFromNotification,
} = await import('../src/tasks.js')
const { scanTranscripts } = await import('../src/discover.js')
const { forEachLine } = await import('../src/lines.js')

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001'
const SLUG = '-home-demo-api'
const OUT_DIR = join(base, SLUG, SESSION, 'tasks')

/* ------------------------------------------------------------------ líneas sintéticas */

let seq = 0
function assistantToolUse(id: string, name: string, input: unknown, ts: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${++seq}`,
    parentUuid: null,
    timestamp: ts,
    sessionId: SESSION,
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'tool_use', id, name, input }] },
  })
}

function userToolResult(id: string, toolUseResult: unknown, content: string, ts: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: `u-${++seq}`,
    parentUuid: null,
    timestamp: ts,
    sessionId: SESSION,
    toolUseResult,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  })
}

function notification(body: string): string {
  return `<task-notification>\n${body}\n</task-notification>`
}

function queued(content: string, ts: string, operation = 'enqueue'): string {
  return JSON.stringify({ type: 'queue-operation', operation, timestamp: ts, sessionId: SESSION, content })
}

function delivered(content: string, ts: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: `u-${++seq}`,
    parentUuid: null,
    timestamp: ts,
    sessionId: SESSION,
    origin: { kind: 'task-notification' },
    message: { role: 'user', content },
  })
}

console.log('resumen del resultado de una herramienta')

const bgResult = { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b3imuss1j' }
const bgDescribed = describeToolResult('Bash', bgResult)
check(bgDescribed.stat?.kind === 'taskStarted', 'un Bash en background no se resume como «sin salida»')
check(/b3imuss1j/.test(bgDescribed.summary), `y dice el id de la tarea: «${bgDescribed.summary}»`)

const monitorDescribed = describeToolResult(undefined, { taskId: 'ba1scqwuh', timeoutMs: 1800000, persistent: false })
check(
  monitorDescribed.stat?.kind === 'taskStarted' && monitorDescribed.stat.task === 'monitor',
  'un monitor se reconoce por su forma aunque no se sepa la herramienta',
)

const plain = describeToolResult('Bash', { stdout: 'ok', stderr: '' })
check(plain.stat?.kind === 'stdout', 'un Bash normal sigue resumiéndose por su stdout')

/* ------------------------------------------------------------------ parser */

console.log('\nparser: nacimiento, eventos, fin y duplicados')

const parser = new TranscriptParser({ sessionId: SESSION, agentId: null, cwd: '/home/demo/api' })
const tracker = new TaskTracker(SESSION, SLUG)
const feed = (line: string) => {
  const result = parser.parse(line)
  for (const update of result.tasks) tracker.apply(update)
  return result
}

const t0 = '2026-09-15T10:00:00.000Z'
feed(assistantToolUse('toolu_1', 'Bash', { command: 'PORT=3305 pnpm run start:local', description: 'Arrancar el front', run_in_background: true }, t0))
const shellStart = feed(
  userToolResult(
    'toolu_1',
    { stdout: '', stderr: '', backgroundTaskId: 'bsh3ll001' },
    `Command running in background with ID: bsh3ll001. Output is being written to: ${join(OUT_DIR, 'bsh3ll001.output')}. You will be notified when it completes.`,
    '2026-09-15T10:00:01.000Z',
  ),
)
const shell = tracker.get('bsh3ll001')
check(shellStart.tasks.length === 1 && shellStart.tasks[0].action === 'start', 'el resultado del Bash hace nacer la tarea')
check(shell?.kind === 'shell' && shell.command === 'PORT=3305 pnpm run start:local', 'con el comando que se lanzó, que solo estaba en la llamada')
check(shell?.description === 'Arrancar el front', 'y su descripción')
check(shell?.outputPath === join(OUT_DIR, 'bsh3ll001.output'), 'la ruta de salida se saca del texto que vio el modelo')
check(shell?.state === 'running', 'y arranca en marcha')

feed(assistantToolUse('toolu_2', 'Monitor', { command: 'tail -f app.log | grep --line-buffered ERROR', description: 'errores en app.log', timeout_ms: 1800000 }, '2026-09-15T10:00:05.000Z'))
feed(userToolResult('toolu_2', { taskId: 'bm0n1t0r1', timeoutMs: 1800000, persistent: false }, 'Monitor started (task bm0n1t0r1, expires in 30m…)', '2026-09-15T10:00:06.000Z'))
const monitor = tracker.get('bm0n1t0r1')
check(monitor?.kind === 'monitor' && monitor.timeoutMs === 1800000, 'el monitor nace con su plazo')
check(monitor?.outputPath === outputPathFor(SLUG, SESSION, 'bm0n1t0r1'), 'y con la ruta de salida deducida, que el resultado no la trae')

const event = notification('<task-id>bm0n1t0r1</task-id>\n<summary>Monitor event: "errores en app.log"</summary>\n<event>ERROR conexión rechazada</event>')
const queuedEvent = feed(queued(event, '2026-09-15T10:01:00.067Z'))
check(
  queuedEvent.tasks.length === 1 && queuedEvent.tasks[0].action === 'event',
  'un aviso encolado (queue-operation) es un evento del monitor',
)
check(
  queuedEvent.events.length === 1 && queuedEvent.events[0].kind === 'task_event' && queuedEvent.events[0].station === 'terminal',
  'y entra en la timeline como task_event de la Terminal',
)
const deliveredEvent = feed(delivered(event, '2026-09-15T10:01:00.078Z'))
check(deliveredEvent.tasks.length === 0 && deliveredEvent.events.length === 0, 'el mismo aviso entregado 11 ms después no cuenta dos veces')
check(tracker.get('bm0n1t0r1')?.events === 1, `el monitor lleva 1 evento (${tracker.get('bm0n1t0r1')?.events})`)

const repeat = feed(queued(event, '2026-09-15T10:02:00.000Z'))
check(repeat.tasks.length === 1, 'el mismo texto un minuto después sí es otro evento')
check(tracker.get('bm0n1t0r1')?.events === 2, 'y el monitor lleva 2')
check(tracker.get('bm0n1t0r1')?.lastEvent === 'ERROR conexión rechazada', 'con el último evento a mano')

// Claude estaba ocupado: dos eventos iguales se encolan seguidos y se entregan juntos, medio
// minuto después. Son dos, no tres ni cuatro.
const late = feed(queued(event, '2026-09-15T10:02:30.000Z'))
const lateDelivered = feed(delivered(`${event}\n${event}`, '2026-09-15T10:03:05.000Z'))
check(
  late.tasks.length === 1 && lateDelivered.tasks.length === 0 && tracker.get('bm0n1t0r1')?.events === 3,
  `las entregas tardías se emparejan con sus encolados (${tracker.get('bm0n1t0r1')?.events} eventos, esperados 3)`,
)

// Al retirarla de la cola se escribe otra vez, con `operation: remove` y el mismo texto: no es
// otro evento (en una sesión real, seis eventos salían como doce).
const removed = feed(queued(event, '2026-09-15T10:03:10.000Z', 'remove'))
check(removed.tasks.length === 0 && tracker.get('bm0n1t0r1')?.events === 3, 'la retirada de la cola («remove») no cuenta')

// Y una notificación entregada sin encolado previo (versiones antiguas) cuenta una vez.
const direct = notification('<task-id>bm0n1t0r1</task-id>\n<summary>Monitor event: "errores en app.log"</summary>\n<event>ERROR otra cosa</event>')
feed(delivered(direct, '2026-09-15T10:03:30.000Z'))
check(tracker.get('bm0n1t0r1')?.events === 4, 'una entrega sin encolado previo cuenta una vez')

const done = notification(
  `<task-id>bsh3ll001</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>${join(OUT_DIR, 'bsh3ll001.output')}</output-file>\n<status>completed</status>\n<summary>Background command "Arrancar el front" completed (exit code 0)</summary>`,
)
feed(queued(done, '2026-09-15T10:05:00.000Z'))
feed(delivered(done, '2026-09-15T10:05:00.010Z'))
check(tracker.get('bsh3ll001')?.state === 'completed', 'el aviso de fin cierra el shell')
check(tracker.get('bsh3ll001')?.exitCode === 0, 'con su exit code')
check(tracker.get('bsh3ll001')?.endedAt === '2026-09-15T10:05:00.000Z', 'y la hora del aviso')

const agentDone = notification('<task-id>a37322b13ddb98689</task-id>\n<status>completed</status>\n<summary>Agent "Explorar websocket" finished</summary>\n<result>informe</result>')
const agentResult = feed(queued(agentDone, '2026-09-15T10:06:00.000Z'))
check(agentResult.tasks.length === 0, 'el aviso de un subagente no es una tarea de la Terminal')

feed(assistantToolUse('toolu_3', 'TaskStop', { task_id: 'bm0n1t0r1' }, '2026-09-15T10:07:00.000Z'))
const stopped = feed(
  userToolResult(
    'toolu_3',
    { message: 'Successfully stopped task: bm0n1t0r1 (tail -f app.log)', task_id: 'bm0n1t0r1', task_type: 'local_bash', command: 'tail -f app.log' },
    '{"message":"Successfully stopped task: bm0n1t0r1"}',
    '2026-09-15T10:07:01.000Z',
  ),
)
check(tracker.get('bm0n1t0r1')?.state === 'stopped', 'TaskStop para el monitor')
const stoppedEvent = stopped.events[0]
check(
  stoppedEvent?.stat?.kind === 'taskEnded' && stoppedEvent.stat.task === 'monitor',
  'y el resumen sabe que lo parado era un monitor, porque lo vio nacer',
)
check(stoppedEvent?.station === 'terminal', 'TaskStop es cosa de la Terminal')
check(!tracker.hasOpen(), 'no queda nada abierto')

/* ------------------------------------------------------------------ notificaciones sueltas */

console.log('\nnotificaciones')

const failedShell = updateFromNotification(
  parseTaskNotifications(notification('<task-id>x</task-id>\n<status>completed</status>\n<summary>Background command "tests" completed (exit code 2)</summary>'))[0],
  t0,
)
check(failedShell?.action === 'end' && failedShell.status === 'failed' && failedShell.exitCode === 2, 'exit code distinto de 0 es un fallo')

const expired = updateFromNotification(
  parseTaskNotifications(notification('<task-id>x</task-id>\n<summary>Monitor "errores" expired after 30m with 3 events</summary>'))[0],
  t0,
)
check(expired?.action === 'end' && expired.status === 'expired', 'un monitor que caduca, caduca')

// Así lo dice Claude Code 2.1.272 cuando el script del monitor termina por sí mismo.
const streamEnded = updateFromNotification(
  parseTaskNotifications(notification('<task-id>x</task-id>\n<tool-use-id>toolu_9</tool-use-id>\n<status>completed</status>\n<summary>Monitor "prueba del visor" stream ended</summary>'))[0],
  t0,
)
check(
  streamEnded?.action === 'end' && streamEnded.status === 'completed' && streamEnded.kind === 'monitor',
  'un monitor cuyo script termina solo acaba en «completed» («stream ended»)',
)

const two = parseTaskNotifications(`${notification('<task-id>a</task-id>\n<summary>Monitor event: "x"</summary>\n<event>1</event>')}\n${notification('<task-id>b</task-id>\n<summary>Monitor event: "x"</summary>\n<event>2</event>')}`)
check(two.length === 2 && two[1].event === '2', 'un mensaje puede traer varias notificaciones')

check(endMarkerOf('línea\n\n[killed]\n')?.status === 'stopped', '«[killed]» al final del .output es una parada')
check(endMarkerOf('ok\n\n[exited with code 0]')?.status === 'completed', '«[exited with code 0]» es un fin limpio')
check(endMarkerOf('boom\n\n[exited with code 137]')?.exitCode === 137, 'y el código se conserva')
check(endMarkerOf('todavía corriendo') === null, 'sin marcador no se cierra nada')

/* ------------------------------------------------------------------ procesos */

console.log('\nemparejado con procesos')

const wrapper = (pid: number, command: string, startedAtMs: number) => ({
  pid,
  cmdline: `/bin/bash -c source /home/x/.claude/shell-snapshots/s.sh 2>/dev/null || true && eval ${command} < /dev/null && pwd -P >| /tmp/claude-x-cwd`,
  startedAtMs,
})
const started = Date.parse('2026-09-15T14:13:08.800Z')
const candidates = [
  wrapper(101, "'npm test -- orders'", started - 600_000),
  wrapper(102, '/tmp/scratch/watch_change.sh', started + 1800),
  wrapper(103, "'sleep 30'", started + 120_000),
]
const byCommand = matchProcess({ command: '/tmp/scratch/watch_change.sh', startedAt: '2026-09-15T14:13:08.800Z' }, candidates, new Set())
check(byCommand?.pid === 102, 'se encuentra el proceso por el comando')
const byTime = matchProcess({ command: 'echo "algo con comillas"; sleep 1', startedAt: '2026-09-15T14:13:08.800Z' }, candidates, new Set())
check(byTime?.pid === 102, 'y, si el shell reescribió las comillas, por la hora de arranque')
const taken = new Set([102])
const none = matchProcess({ command: '/tmp/scratch/watch_change.sh', startedAt: '2026-09-15T14:13:08.800Z' }, candidates, taken)
check(none === null, 'un proceso ya asignado a otra tarea no se reparte')

/* ------------------------------------------------------------------ rastreador */

console.log('\nrastreador: fichero de salida, --resume y residuos')

await mkdir(OUT_DIR, { recursive: true })
const t2 = new TaskTracker(SESSION, SLUG)
t2.apply({ action: 'start', id: 'bfile0001', kind: 'shell', ts: '2026-09-15T10:00:00.000Z', command: 'npm test' })
await writeFile(join(OUT_DIR, 'bfile0001.output'), 'FAIL 3 tests\n\n[exited with code 3]\n', 'utf8')
await t2.refresh(undefined, { now: Date.parse('2026-09-15T10:00:30.000Z') })
check(t2.get('bfile0001')?.state === 'failed' && t2.get('bfile0001')?.exitCode === 3, 'el marcador del .output cierra la tarea con su código')
check(t2.get('bfile0001')?.outputBytes === 'FAIL 3 tests\n\n[exited with code 3]\n'.length, 'y se anota el tamaño del fichero')

t2.apply({ action: 'start', id: 'bexpire01', kind: 'monitor', ts: '2026-09-15T09:00:00.000Z', command: 'tail -f x', timeoutMs: 60_000 })
await writeFile(join(OUT_DIR, 'bexpire01.output'), '\n[killed]\n', 'utf8')
await t2.refresh(undefined, { now: Date.parse('2026-09-15T09:01:00.000Z') })
check(t2.get('bexpire01')?.state === 'expired', 'un monitor «matado» justo al cumplir su plazo caducó, no lo paró nadie')

t2.apply({ action: 'start', id: 'bold00001', kind: 'monitor', ts: '2026-09-14T09:00:00.000Z', command: 'tail -f y' })
await t2.refresh(undefined, { now: Date.parse('2026-09-15T12:00:00.000Z'), processStartedAt: Date.parse('2026-09-15T08:00:00.000Z') })
check(t2.get('bold00001')?.state === 'stopped', 'una tarea anterior al arranque del proceso murió con el proceso anterior (--resume)')
check(t2.get('bold00001')?.endedAt === '2026-09-15T08:00:00.000Z', 'y acabó cuando arrancó el nuevo')

if (canInspectProcesses()) {
  const t3 = new TaskTracker(SESSION, SLUG)
  t3.apply({ action: 'start', id: 'bghost001', kind: 'shell', ts: new Date().toISOString(), command: 'sleep 999999' })
  // Este mismo proceso hace de sesión: no tiene ningún hijo que sea la tarea.
  await t3.refresh(process.pid)
  check(t3.get('bghost001')?.state === 'running', 'la primera vez sin proceso se le da el beneficio de la duda')
  await t3.refresh(process.pid)
  check(t3.get('bghost001')?.state === 'stale' && t3.get('bghost001')?.alive === false, 'a la segunda, una tarea sin proceso detrás es un residuo')
  check(t3.hasOpen(), 'pero sigue abierta, por si el proceso aparece')
} else {
  console.log('  (sin /proc: no se contrasta con procesos)')
}

const order = new TaskTracker(SESSION, SLUG)
order.apply({ action: 'start', id: 'b1', kind: 'shell', ts: '2026-09-15T10:00:00.000Z', command: 'a' })
order.apply({ action: 'start', id: 'b2', kind: 'shell', ts: '2026-09-15T11:00:00.000Z', command: 'b' })
order.apply({ action: 'end', id: 'b2', ts: '2026-09-15T11:01:00.000Z', status: 'completed', exitCode: 0 })
check(order.list().map((t) => t.id).join(',') === 'b1,b2', 'la lista pone primero lo que sigue en marcha')

const lazy = new TaskTracker(SESSION, SLUG)
lazy.apply({ action: 'event', id: 'bunseen01', ts: t0, text: 'algo', description: 'errores en deploy.log' })
check(lazy.get('bunseen01')?.kind === 'monitor' && lazy.get('bunseen01')?.description === 'errores en deploy.log', 'un evento de un monitor que no se vio nacer lo crea con lo que dice el aviso')
lazy.apply({ action: 'start', id: 'bunseen01', kind: 'monitor', ts: '2026-09-15T09:59:00.000Z', command: 'tail -f deploy.log' })
check(lazy.get('bunseen01')?.command === 'tail -f deploy.log' && lazy.get('bunseen01')?.startedAt === '2026-09-15T09:59:00.000Z', 'y la llamada, si llega después, lo completa sin duplicarlo')

/* ------------------------------------------------------------------ transcripts reales */

console.log('\ntranscripts reales con tareas en segundo plano')

const files = (await scanTranscripts())
  .filter((file) => file.agentId === null && file.sizeBytes < 40 * 1024 * 1024)
  .sort((a, b) => b.mtimeMs - a.mtimeMs)
  .slice(0, 12)
let withTasks = 0
let starts = 0
let ends = 0
let events = 0
let malformed = 0
for (const file of files) {
  const p = new TranscriptParser({ sessionId: file.sessionId, agentId: null })
  const t = new TaskTracker(file.sessionId, file.slug)
  let found = false
  await forEachLine(file.path, (line) => {
    const result = p.parse(line)
    for (const update of result.tasks) {
      found = true
      t.apply(update)
      if (update.action === 'start') starts++
      else if (update.action === 'end') ends++
      else events++
    }
  })
  if (!found) continue
  withTasks++
  for (const task of t.list()) {
    if (!task.id || Number.isNaN(Date.parse(task.startedAt))) malformed++
  }
}
if (withTasks === 0) {
  console.log(`  (ninguno de los ${files.length} transcripts recientes lanzó shells ni monitores en segundo plano)`)
} else {
  check(malformed === 0, `${withTasks} transcripts con tareas: ${starts} nacimientos, ${events} eventos, ${ends} finales, ninguna malformada`)
}

if (failures > 0) {
  console.error(`\n${failures} comprobación(es) fallida(s)`)
  process.exit(1)
}
console.log('\ntodo bien')
