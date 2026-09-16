/**
 * Pruebas del reparto del tiempo de una sesión.
 *
 * Con eventos sintéticos se comprueba la regla de atribución (el hueco es de lo que llega), que
 * las pausas se apartan y no se atribuyen a nadie, que una pregunta cuenta como tiempo tuyo y no
 * de la herramienta, y que varias herramientas en paralelo no suman dos veces el mismo segundo.
 * Después se pasa por tus transcripts recientes: las categorías tienen que sumar exactamente el
 * tiempo activo, siempre.
 *
 *   npm run test:timing
 */
import { collectSessionEvents, listHistory } from '../src/history.js'
import { TranscriptParser } from '../src/parser.js'
import {
  TimingAccumulator,
  computeTiming,
  TIMING_CATEGORIES,
  timingSides,
  tokensPerSecond,
} from '../../shared/timing.js'
import type { TimelineEvent } from '../../shared/types.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001'
const T0 = Date.parse('2026-09-16T09:00:00.000Z')
let n = 0

function at(seconds: number): string {
  return new Date(T0 + seconds * 1000).toISOString()
}

function ev(
  kind: TimelineEvent['kind'],
  seconds: number,
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    uuid: `u-${++n}`,
    parentUuid: null,
    sessionId: SESSION,
    agentId: null,
    ts: at(seconds),
    kind,
    station: 'desk',
    summary: extra.summary ?? kind,
    ...extra,
  }
}

const sum = (categories: Record<string, number>) =>
  Object.values(categories).reduce((total, value) => total + value, 0)

/* ------------------------------------------------------------------ atribución */

console.log('atribución de cada hueco')

const script: TimelineEvent[] = [
  ev('prompt', 0, { summary: 'arregla los tests' }),
  ev('thinking', 5),
  ev('text', 7),
  ev('tool_call', 8, { tool: 'Bash', station: 'terminal', toolUseId: 't1', summary: 'npm test' }),
  ev('tool_result', 20, { tool: 'Bash', station: 'terminal', toolUseId: 't1', durationMs: 12_000 }),
  ev('text', 23),
  ev('prompt', 33, { summary: 'vale' }),
]
const r = computeTiming(script)
check(r.categories.thinking === 5000, `pensando: del mensaje al pensamiento, 5 s (${r.categories.thinking})`)
check(r.categories.writing === 2000 + 1000 + 3000, `escribiendo: texto, llamada y respuesta, 6 s (${r.categories.writing})`)
check(r.categories.tools === 12_000, `herramientas: lo que tardó el Bash, 12 s (${r.categories.tools})`)
check(r.categories.waiting === 10_000, `esperándote: del último texto a tu «vale», 10 s (${r.categories.waiting})`)
check(r.activeMs === 33_000 && sum(r.categories) === r.activeMs, 'las categorías suman el tiempo activo')
check(r.turns === 2 && r.calls === 1, 'dos mensajes tuyos y una llamada')
check(r.tools[0]?.tool === 'Bash' && r.tools[0].totalMs === 12_000, 'la tabla por herramienta lleva el Bash')
check(r.slowest[0]?.summary === 'npm test' && r.slowest[0].uuid === script[3].uuid, 'la llamada más larga apunta al evento de la llamada')

const described = computeTiming([
  ev('tool_call', 0, { tool: 'Bash', toolUseId: 'd1', summary: 'cd /x; mvn -q test', payload: { command: 'cd /x; mvn -q test', description: 'Pasar las suites de Core' } }),
  ev('tool_result', 100, { tool: 'Bash', toolUseId: 'd1', durationMs: 100_000 }),
])
check(described.slowest[0]?.summary === 'Pasar las suites de Core', 'la llamada lenta se nombra por su descripción, no por el comando')
const sides = timingSides(r)
check(sides.machine === 23_000 && sides.you === 10_000, 'el reparto máquina / tú cuadra')

/* ------------------------------------------------------------------ pausas */

console.log('\npausas')

const paused = computeTiming(
  [
    ev('prompt', 0),
    ev('text', 4),
    ev('prompt', 3 * 3600), // te fuiste tres horas
    ev('text', 3 * 3600 + 6),
  ],
  { pauseMs: 30 * 60_000 },
)
check(paused.pauses === 1 && paused.pausedMs === (3 * 3600 - 4) * 1000, 'tres horas sin actividad se apartan como pausa')
check(paused.activeMs === 10_000 && paused.categories.waiting === 0, 'y no se atribuyen a nadie, ni a la espera')
check(sum(paused.categories) === paused.activeMs, 'las categorías siguen sumando el activo')

const resumed = computeTiming(
  [
    ev('tool_call', 0, { tool: 'Bash', toolUseId: 'r1' }),
    ev('tool_result', 5 * 3600, { tool: 'Bash', toolUseId: 'r1', durationMs: 5 * 3600 * 1000 }),
  ],
  { pauseMs: 30 * 60_000 },
)
check(resumed.categories.tools === 0 && resumed.pauses === 1, 'un resultado que llega horas después atravesó un cierre: pausa, no herramienta')
check(resumed.tools[0]?.totalMs === 30 * 60_000, 'y en la tabla esa llamada se topa al umbral')

/* ------------------------------------------------------------------ preguntas, permisos, agentes */

console.log('\nlo que es tuyo aunque lo pida una herramienta')

const asking = computeTiming([
  ev('tool_call', 0, { tool: 'AskUserQuestion', station: 'showcase', toolUseId: 'q1' }),
  ev('tool_result', 90, { tool: 'AskUserQuestion', station: 'showcase', toolUseId: 'q1', durationMs: 90_000 }),
  ev('tool_call', 92, { tool: 'Agent', toolUseId: 'a1' }),
  ev('tool_result', 200, { tool: 'Agent', toolUseId: 'a1', durationMs: 108_000 }),
])
check(asking.categories.asking === 90_000 && asking.categories.tools === 0, 'una pregunta de 90 s es espera tuya, no herramienta')
check(asking.slowest.every((call) => call.tool !== 'AskUserQuestion'), 'y no sale entre las llamadas lentas')
check(asking.categories.agents === 108_000, 'un Agent síncrono es espera a subagentes')

const permission = computeTiming([
  ev('tool_call', 0, { tool: 'Bash', toolUseId: 'p1' }),
  ev('permission', 0.2, { summary: 'esperando permiso: Bash rm -rf' }),
  ev('tool_result', 40, { tool: 'Bash', toolUseId: 'p1', durationMs: 40_000 }),
])
check(permission.categories.permission === 39_800, `con el hook, la espera de permiso se separa (${permission.categories.permission} ms)`)
check(permission.categories.writing === 200, 'y el hueco hasta el aviso es de componer la llamada')

/* ------------------------------------------------------------------ paralelismo */

console.log('\nherramientas en paralelo')

const parallel = computeTiming([
  ev('tool_call', 0, { tool: 'Read', toolUseId: 'x1' }),
  ev('tool_call', 0.5, { tool: 'Grep', toolUseId: 'x2' }),
  ev('tool_result', 3, { tool: 'Read', toolUseId: 'x1', durationMs: 3000 }),
  ev('tool_result', 4, { tool: 'Grep', toolUseId: 'x2', durationMs: 3500 }),
  ev('text', 6),
])
check(parallel.categories.tools === 3500 && parallel.categories.writing === 2500, 'dos llamadas solapadas no cuentan el mismo segundo dos veces')
check(parallel.tools.reduce((t, row) => t + row.totalMs, 0) === 6500, 'pero en la tabla por herramienta cada una lleva su duración')

/* ------------------------------------------------------------------ subagentes y ruido */

console.log('\nsubagentes y eventos sintéticos')

// Una llamada interrumpida no llega a tener resultado: no puede quedarse «corriendo» y llevarse
// las esperas que vienen después.
const interrupted = computeTiming([
  ev('tool_call', 0, { tool: 'Bash', toolUseId: 'i1' }),
  ev('prompt', 4, { summary: 'para, para' }),
  ev('text', 6),
  ev('task_event', 66, { tool: 'Monitor', station: 'terminal' }), // un aviso mientras te espera
  ev('prompt', 120),
])
check(
  interrupted.categories.tools === 0 && interrupted.categories.waiting === 4000 + 60_000 + 54_000,
  `tras tu interrupción nada sigue pendiente: los huecos son espera (${interrupted.categories.waiting} ms)`,
)

const withAgent = computeTiming([
  ev('prompt', 0),
  ev('agent_spawn', 9999, { agentId: null }), // sintético: hora de cuando se dedujo
  ev('text', 3),
  ev('tool_call', 10, { agentId: 'ag1', tool: 'Read', toolUseId: 'g1', actor: { id: 'ag1', sessionId: SESSION, kind: 'subagent', agentType: 'Explore', depth: 1 } }),
  ev('tool_result', 70, { agentId: 'ag1', tool: 'Read', toolUseId: 'g1' }),
  ev('text', 80),
])
check(withAgent.categories.writing === 3000 + 77_000 && withAgent.pauses === 0, 'los eventos sintéticos de nacimiento no marcan el tiempo')
check(withAgent.agents[0]?.agentType === 'Explore' && withAgent.agents[0].ms === 60_000, 'el subagente informa su propio tiempo, en paralelo')
check(withAgent.events === 6, 'se cuentan todos los eventos recibidos')

const empty = computeTiming([])
check(empty.activeMs === 0 && empty.spanMs === 0 && sum(empty.categories) === 0, 'sin eventos, todo a cero y sin explotar')

/* ------------------------------------------------------------------ por modelo */

console.log('\npor modelo')

const speedy = computeTiming([
  ev('prompt', 0),
  ev('thinking', 4, { model: 'claude-opus-5', tokens: { input: 10, output: 900, cacheRead: 0, cacheCreate: 0 } }),
  ev('text', 6, { model: 'claude-opus-5' }), // mismo mensaje: el parser ya no repite los tokens
  ev('tool_call', 7, { model: 'claude-opus-5', tool: 'Bash', toolUseId: 's1' }),
  ev('tool_result', 10, { tool: 'Bash', toolUseId: 's1', durationMs: 3000 }),
  ev('text', 12, { model: 'claude-haiku-4-5', tokens: { input: 5, output: 100, cacheRead: 0, cacheCreate: 0 } }),
])
const opus = speedy.models.find((row) => row.model === 'claude-opus-5')
const haiku = speedy.models.find((row) => row.model === 'claude-haiku-4-5')
check(opus?.responses === 1 && haiku?.responses === 1, 'cada toma de palabra es una respuesta, aunque tenga tres bloques')
check(opus?.thinkingMs === 4000 && opus?.writingMs === 3000, 'el tiempo de pensar y escribir va al modelo del bloque')
check(opus?.outputTokens === 900 && haiku?.outputTokens === 100, 'los tokens de salida se cuentan una vez por respuesta')
check(Math.round(tokensPerSecond(opus!)! * 10) / 10 === 128.6, `y salen tokens por segundo (${tokensPerSecond(opus!)?.toFixed(1)})`)
check(tokensPerSecond({ thinkingMs: 0, writingMs: 0, outputTokens: 0 }) === null, 'sin tiempo ni tokens no hay velocidad que inventar')

/* ------------------------------------------------------------------ parser: tokens y paralelas */

console.log('\nparser: tokens una vez por respuesta y duración de las llamadas paralelas')

const parser = new TranscriptParser({ sessionId: SESSION, agentId: null })
const line = (block: unknown, ts: string, id = 'msg_1'): string =>
  JSON.stringify({
    type: 'assistant',
    uuid: `p-${++n}`,
    parentUuid: null,
    timestamp: ts,
    sessionId: SESSION,
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      usage: { input_tokens: 32, output_tokens: 4829, cache_read_input_tokens: 83101, cache_creation_input_tokens: 0 },
      content: [block],
    },
  })
const parsed = [
  parser.parse(line({ type: 'thinking', thinking: 'a ver…' }, at(0))),
  parser.parse(line({ type: 'tool_use', id: 'tu_a', name: 'Bash', input: { command: 'sleep 1' } }, at(2))),
  parser.parse(line({ type: 'tool_use', id: 'tu_b', name: 'Bash', input: { command: 'sleep 2' } }, at(20))),
]
const withTokens = parsed.flatMap((result) => result.events).filter((event) => event.tokens)
check(withTokens.length === 1 && withTokens[0]!.tokens!.output === 4829, 'de tres líneas del mismo mensaje, solo la primera lleva los tokens')
check(parsed[0]!.hints.tokens !== undefined && parsed[2]!.hints.tokens === undefined, 'y la sesión los suma una vez, no por bloque')
check(parsed[2]!.hints.lastContextTokens === 32 + 83101, 'el contexto en uso sí se lee en cualquier línea')

const resultLine = (toolUseId: string, ts: string): string =>
  JSON.stringify({
    type: 'user',
    uuid: `p-${++n}`,
    parentUuid: null,
    timestamp: ts,
    sessionId: SESSION,
    toolUseResult: { stdout: 'ok', stderr: '' },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] },
  })
const resultA = parser.parse(resultLine('tu_a', at(30))).events[0]!
const resultB = parser.parse(resultLine('tu_b', at(31))).events[0]!
check(resultA.durationMs === 10_000, `la primera llamada paralela dura desde el último bloque, 10 s, no 28 (${resultA.durationMs})`)
check(resultB.durationMs === 11_000, `y la segunda 11 s (${resultB.durationMs})`)

const other = parser.parse(line({ type: 'text', text: 'listo' }, at(40), 'msg_2')).events[0]!
check(other.tokens?.output === 4829, 'un mensaje nuevo vuelve a traer sus tokens')

/* ------------------------------------------------------------------ por día (métricas) */

console.log('\nreparto por día, para las métricas')

const byDay: Record<string, number> = {}
const acc = new TimingAccumulator({
  onGap: (category, ms, fromTs) => {
    if (category !== 'pause') byDay[fromTs.slice(0, 10)] = (byDay[fromTs.slice(0, 10)] ?? 0) + ms
  },
})
// Una llamada que empieza a las 23:59:30 y acaba a las 00:00:30: el minuto cae en el día en que empezó.
const midnight = Date.parse('2026-09-15T23:59:30.000Z')
const late = (seconds: number, kind: TimelineEvent['kind'], extra: Partial<TimelineEvent> = {}) =>
  ev(kind, 0, { ...extra, ts: new Date(midnight + seconds * 1000).toISOString() })
acc.push(late(0, 'tool_call', { tool: 'Bash', toolUseId: 'm1' }))
acc.push(late(60, 'tool_result', { tool: 'Bash', toolUseId: 'm1', durationMs: 60_000 }))
acc.push(late(70, 'text'))
check(byDay['2026-09-15'] === 60_000 && byDay['2026-09-16'] === 10_000, 'cada hueco cae en el día en que empezó')
check(acc.report().categories.tools === 60_000 && acc.report().categories.writing === 10_000, 'y el informe del acumulador coincide con lo avisado')

/* ------------------------------------------------------------------ transcripts reales */

console.log('\ntranscripts reales')

const sessions = (await listHistory()).slice(0, 6)
let checked = 0
for (const session of sessions) {
  const events = await collectSessionEvents(session.sessionId, true)
  if (!events || events.length < 2) continue
  const report = computeTiming(events)
  const total = sum(report.categories)
  const ok =
    total === report.activeMs &&
    TIMING_CATEGORIES.every((category) => report.categories[category] >= 0) &&
    report.pausedMs >= 0 &&
    report.spanMs === report.activeMs + report.pausedMs
  checked++
  check(
    ok,
    `${session.project.padEnd(14)} activo ${Math.round(report.activeMs / 60_000)} min · pausas ${report.pauses} · ` +
      `Claude ${Math.round((100 * timingSides(report).machine) / Math.max(1, report.activeMs))}% · ` +
      `tú ${Math.round((100 * timingSides(report).you) / Math.max(1, report.activeMs))}% · ${report.calls} llamadas`,
  )
}
if (checked === 0) console.log('  (sin transcripts que medir)')

if (failures > 0) {
  console.error(`\n${failures} comprobación(es) fallida(s)`)
  process.exit(1)
}
console.log('\ntodo bien')
