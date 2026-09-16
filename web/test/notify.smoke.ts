/**
 * Pruebas de los avisos del navegador, en su parte pura: qué eventos merecen un aviso, cuándo una
 * sesión ha pasado de trabajar a esperarte, y que no se molesta a quien está mirando.
 *
 *   npm run test:notify
 */
import { idleNotice, idleTransitions, lastTextOf, noticeForEvent, shouldDisturb } from '../src/notify.js'
import type { SessionInfo, TimelineEvent } from '../../shared/types.js'

let failures = 0

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001'

function ev(kind: TimelineEvent['kind'], extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    uuid: 'u',
    parentUuid: null,
    sessionId: SESSION,
    agentId: null,
    ts: '2026-09-16T10:00:00.000Z',
    kind,
    station: 'desk',
    summary: extra.summary ?? kind,
    ...extra,
  }
}

function session(status: SessionInfo['status'], live = true): SessionInfo {
  return {
    sessionId: SESSION,
    cwd: '/home/demo/backend',
    project: 'backend',
    slug: '-home-demo-backend',
    transcriptPath: '/tmp/x.jsonl',
    status,
    live,
  }
}

console.log('qué merece un aviso')

const permission = noticeForEvent(ev('permission', { summary: 'esperando permiso: Bash rm -rf dist' }), 'backend')
check(permission?.title.es === 'backend · Claude pide permiso', 'un permiso pendiente avisa, con el proyecto delante')
check(permission?.body === 'Bash rm -rf dist', 'y el cuerpo es lo que pide, sin la muletilla')
check(permission?.tag === `${SESSION}:permission`, 'con una etiqueta por sesión y tipo, para que el siguiente sustituya al anterior')

const question = noticeForEvent(
  ev('tool_call', { tool: 'AskUserQuestion', station: 'showcase', summary: '¿Qué destino usamos para el despliegue?' }),
  'backend',
)
check(question?.title.en === 'backend · Claude has a question for you', 'una pregunta avisa, en los dos idiomas')
check(question?.body === '¿Qué destino usamos para el despliegue?', 'con la pregunta como cuerpo')

const plan = noticeForEvent(ev('tool_call', { tool: 'ExitPlanMode', station: 'showcase' }), 'backend')
check(plan?.title.es.includes('plan') === true, 'un plan por aprobar también')

check(noticeForEvent(ev('tool_call', { tool: 'Bash', summary: 'npm test' }), 'backend') === null, 'un Bash cualquiera no molesta')
check(noticeForEvent(ev('text', { summary: 'Voy a mirar los tests.' }), 'backend') === null, 'ni el texto de Claude mientras trabaja')

const long = noticeForEvent(ev('permission', { summary: `esperando permiso: ${'x'.repeat(300)}` }), 'backend')
check((long?.body.length ?? 0) <= 140 && long!.body.endsWith('…'), 'el cuerpo se recorta a una línea de aviso')

console.log('\nfin de turno')

const turned = idleTransitions([session('busy')], [session('idle')])
check(turned.length === 1, 'pasar de trabajando a esperándote es un fin de turno')
check(idleTransitions([session('idle')], [session('idle')]).length === 0, 'seguir esperando no vuelve a avisar')
check(idleTransitions([session('busy')], [session('idle', false)]).length === 0, 'una sesión cerrada no avisa')
check(idleTransitions([], [session('idle')]).length === 0, 'la primera vez que se ve una sesión esperando tampoco: no se sabe si acaba de terminar')
check(idleTransitions([session('unknown')], [session('idle')]).length === 0, 'desde «desconocido» no es un fin de turno')

const notice = idleNotice(session('idle'), 'Todo cerrado. Puedes apagar.')
check(notice.title.es === 'backend · Claude te espera' && notice.body === 'Todo cerrado. Puedes apagar.', 'el aviso dice qué fue lo último que dijo Claude')
check(
  lastTextOf([
    ev('text', { summary: 'primero' }),
    ev('text', { summary: 'del subagente', agentId: 'ag1' }),
    ev('tool_call', { tool: 'Bash' }),
    ev('text', { summary: 'lo último' }),
    ev('tool_result', { tool: 'Bash' }),
  ]) === 'lo último',
  'lo último que dijo Claude es su último texto, no el de un subagente ni un resultado',
)
check(lastTextOf([ev('tool_call')]) === undefined, 'y si no dijo nada, nada')

console.log('\ncuándo molestar')
check(shouldDisturb({ hidden: true, focused: false }), 'con la pestaña oculta, sí')
check(shouldDisturb({ hidden: false, focused: false }), 'con la ventana detrás de otra, sí')
check(!shouldDisturb({ hidden: false, focused: true }), 'si estás mirando, no')

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} comprobación(es) fallida(s)`)
process.exit(failures === 0 ? 0 : 1)
