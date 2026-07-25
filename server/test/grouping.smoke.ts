/**
 * Regresión del ritmo del mundo, con transcripts reales.
 *
 * Comprueba que la representación no se «come» los pasos de una conversación: se alimenta
 * la regla de agrupación REAL (web/src/world/grouping.ts, la misma que usa el director) con
 * sesiones enteras y se cuenta cuántas acciones vería el espectador.
 *
 *   npm run test:grouping
 */
import { scanTranscripts } from '../src/discover.js'
import { readSessionEvents } from '../src/history.js'
import { shouldMerge, type Groupable } from '../../web/src/world/grouping.js'
import type { TimelineEvent } from '../../shared/types.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

/**
 * Reproduce la lógica de colas del director: una cola por actor, agrupando con la regla
 * real. `drain` simula que el reproductor va sacando acciones (el caso normal), frente a
 * una ráfaga en la que todo entra de golpe.
 */
function simulate(events: TimelineEvent[], drain: boolean): number {
  const queues = new Map<string, (Groupable & { count: number })[]>()
  let emitted = 0

  for (const event of events) {
    const actorId = event.kind === 'prompt' ? 'user' : (event.agentId ?? 'main')
    const queue = queues.get(actorId) ?? []
    if (!queues.has(actorId)) queues.set(actorId, queue)

    const station = ['tool_call', 'tool_result', 'skill'].includes(event.kind)
      ? event.station
      : undefined
    const action = { kind: event.kind, station, tool: event.tool, count: 1 }

    if (shouldMerge(queue[queue.length - 1], action, queue.length)) {
      queue[queue.length - 1].count++
      continue
    }
    queue.push(action)
    // El reproductor entrega los eventos con ritmo, así que la cola se vacía a la vez.
    if (drain && queue.length > 0) {
      queue.shift()
      emitted++
    }
  }

  for (const queue of queues.values()) emitted += queue.length
  return emitted
}

const files = await scanTranscripts()
const mains = files.filter((f) => f.agentId === null).sort((a, b) => b.sizeBytes - a.sizeBytes)

for (const file of mains.slice(0, 3)) {
  const { events, total } = await readSessionEvents(file.sessionId, { limit: 2000, includeAgents: true })
  if (events.length === 0) continue

  const steps = simulate(events, true)
  const burst = simulate(events, false)
  const tools = events.filter((e) => e.kind === 'tool_call' || e.kind === 'skill').length

  console.log(`\n${file.sessionId.slice(0, 8)} · ${total} eventos · ${tools} llamadas a herramientas`)
  console.log(`  pasos representados (ritmo normal): ${steps}`)
  console.log(`  pasos si todo entra de golpe:       ${burst}`)

  // Con ritmo normal no debe perderse prácticamente nada: es el fallo que se corrigió.
  check(steps >= events.length * 0.98, `se representa el ${((steps / events.length) * 100).toFixed(0)}% de los eventos`)
  // En ráfaga sí se agrupa, pero sin colapsar la conversación a un puñado de pasos.
  check(burst > events.length * 0.5, `en ráfaga se conserva el ${((burst / events.length) * 100).toFixed(0)}% (agrupando)`)
}

console.log('\nagrupación: casos concretos')
const call = { kind: 'tool_call' as const, station: 'library' as const, tool: 'Read' }
const result = { kind: 'tool_result' as const, station: 'library' as const, tool: 'Read' }
check(!shouldMerge(call, result, 9), 'un tool_result nunca se fusiona con su tool_call')
check(shouldMerge(call, call, 9), 'dos Read seguidos se agrupan cuando hay atasco')
check(!shouldMerge(call, call, 1), 'con la cola corta no se agrupa nada')
check(
  !shouldMerge(call, { kind: 'tool_call', station: 'terminal', tool: 'Bash' }, 9),
  'herramientas distintas no se agrupan',
)

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} comprobación(es) fallida(s)`)
process.exit(failures === 0 ? 0 : 1)
