/**
 * Pruebas del resumen de sesión que alimenta el vecindario.
 *
 * Los dos errores fáciles: contar los resultados además de las llamadas —cada visita saldría
 * doble— y tomar como «lo que está haciendo» el último evento a secas, que puede ser un cambio
 * de modo o un texto y no dice dónde está el actor.
 *
 *   npm run test:hood
 */
import { WINDOW, summarizeSession } from '../src/neighborhood.js'
import type { ActorInfo, TimelineEvent } from '../../shared/types.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

let seq = 0
function event(partial: Partial<TimelineEvent>): TimelineEvent {
  seq++
  return {
    uuid: `u${seq}`,
    parentUuid: null,
    sessionId: 's1',
    agentId: null,
    ts: `2026-07-27T10:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    kind: 'tool_call',
    station: 'terminal',
    summary: '',
    ...partial,
  }
}

const agent = (id: string, done?: boolean): ActorInfo => ({
  id,
  sessionId: 's1',
  kind: 'subagent',
  agentType: 'Explore',
  depth: 1,
  done,
})

console.log('\nrecuento de estaciones')
const pair = [
  event({ kind: 'tool_call', tool: 'Bash', station: 'terminal', toolUseId: 't1' }),
  event({ kind: 'tool_result', tool: 'Bash', station: 'terminal', toolUseId: 't1' }),
]
const one = summarizeSession(pair, [])
check(one.uses.terminal === 1, 'una llamada con su resultado cuenta como una visita, no dos')

const many = summarizeSession(
  [
    event({ station: 'library', tool: 'Read' }),
    event({ station: 'library', tool: 'Grep' }),
    event({ station: 'workshop', tool: 'Edit' }),
    event({ kind: 'skill', station: 'skills', tool: 'Skill' }),
    event({ kind: 'thinking', station: 'desk' }),
    event({ kind: 'text', station: 'desk' }),
  ],
  [],
)
check(many.uses.library === 2 && many.uses.workshop === 1, 'se suma por estación')
check(many.uses.skills === 1, 'una skill también es trabajo en un sitio')
check(many.uses.desk === undefined, 'pensar y hablar no son visitas a ninguna estación')

console.log('\nlo que está haciendo ahora')
check(many.lastStation === 'skills', 'el sitio sale del último trabajo, no del último evento')
check(many.lastTool === 'Skill', 'con su herramienta')

const afterResult = summarizeSession(
  [
    event({ station: 'terminal', tool: 'Bash', toolUseId: 't9' }),
    event({ kind: 'tool_result', station: 'terminal', tool: 'Bash', toolUseId: 't9' }),
    event({ kind: 'meta', station: 'unknown' }),
  ],
  [],
)
check(afterResult.lastStation === 'terminal', 'un evento meta posterior no mueve al actor')

const failed = summarizeSession(
  [
    event({ station: 'terminal', tool: 'Bash', toolUseId: 'tf' }),
    event({ kind: 'tool_result', station: 'terminal', toolUseId: 'tf', isError: true }),
  ],
  [],
)
check(failed.lastFailed, 'si el resultado vino con error, la tarjeta lo puede decir')
check(!afterResult.lastFailed, 'y si no, no')

console.log('\nsubagentes y ventana')
const agents = summarizeSession([event({})], [agent('a1', true), agent('a2')])
check(agents.agents[0]?.id === 'a2', 'los subagentes vivos van primero')
check(agents.agents.length === 2, 'los terminados siguen listados, para ver que estuvieron')

const long = Array.from({ length: WINDOW + 50 }, () => event({ station: 'terminal' }))
const windowed = summarizeSession(long, [])
check(windowed.seen === WINDOW, `solo se miran los últimos ${WINDOW} eventos (${windowed.seen})`)
check(windowed.uses.terminal === WINDOW, 'y el recuento es el de esa ventana')

const empty = summarizeSession([], [])
check(empty.lastStation === null && empty.seen === 0, 'una sesión sin actividad no inventa nada')

console.log(failures === 0 ? '\ntodo en orden\n' : `\n${failures} fallo(s)\n`)
process.exit(failures === 0 ? 0 : 1)
