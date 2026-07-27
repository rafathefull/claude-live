/**
 * Genera un `~/.claude` de mentira: una sesión ficticia con sus subagentes, en el mismo
 * formato que escribe Claude Code de verdad.
 *
 * Sirve para dos cosas: sacar capturas para el README sin exponer código ni rutas reales, y
 * poder probar el visor (o montarlo en CI) sin depender de los transcripts de nadie.
 */
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const SESSION_ID = 'dec0de00-0000-4000-8000-000000000001'
const CWD = '/home/demo/proyectos/tienda-api'
const SLUG = CWD.replace(/[^a-zA-Z0-9]/g, '-')
const MODEL = 'claude-opus-5'
const AGENT_EXPLORE = 'a11ce00explore01'
const AGENT_EXPLORE2 = 'c33ef00explore03'
const AGENT_PLAN = 'b22df00plan00002'

/** Un paso del guion: en qué fichero cae y qué línea se escribe. */
export interface DemoStep {
  target: 'main' | typeof AGENT_EXPLORE | typeof AGENT_EXPLORE2 | typeof AGENT_PLAN
  line: Record<string, unknown>
}

interface Ctx {
  ts: number
  parent: Record<string, string | null>
  /** Para las conversaciones del histórico, que son de otras sesiones y otros proyectos. */
  sessionId?: string
  cwd?: string
  branch?: string
}

function next(ctx: Ctx, seconds: number): string {
  ctx.ts += seconds * 1000
  return new Date(ctx.ts).toISOString()
}

function envelope(
  ctx: Ctx,
  target: DemoStep['target'],
  seconds: number,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const uuid = randomUUID()
  const parentUuid = ctx.parent[target] ?? null
  ctx.parent[target] = uuid
  return {
    uuid,
    parentUuid,
    sessionId: ctx.sessionId ?? SESSION_ID,
    cwd: ctx.cwd ?? CWD,
    gitBranch: ctx.branch ?? 'main',
    version: '2.1.220',
    isSidechain: target !== 'main',
    timestamp: next(ctx, seconds),
    ...extra,
  }
}

const usage = (input: number, output: number, cacheRead: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
})

function prompt(ctx: Ctx, target: DemoStep['target'], text: string, seconds = 1): DemoStep {
  return {
    target,
    line: envelope(ctx, target, seconds, {
      type: 'user',
      userType: 'external',
      message: { role: 'user', content: [{ type: 'text', text }] },
    }),
  }
}

function thinking(ctx: Ctx, target: DemoStep['target'], text: string, seconds = 2): DemoStep {
  return {
    target,
    line: envelope(ctx, target, seconds, {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: MODEL,
        usage: usage(4, 180, 42_000),
        content: [{ type: 'thinking', thinking: text }],
      },
    }),
  }
}

function say(ctx: Ctx, target: DemoStep['target'], text: string, seconds = 2): DemoStep {
  return {
    target,
    line: envelope(ctx, target, seconds, {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: MODEL,
        usage: usage(4, 260, 44_000),
        content: [{ type: 'text', text }],
      },
    }),
  }
}

function call(
  ctx: Ctx,
  target: DemoStep['target'],
  id: string,
  name: string,
  input: unknown,
  seconds = 2,
): DemoStep {
  return {
    target,
    line: envelope(ctx, target, seconds, {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: MODEL,
        usage: usage(4, 120, 45_000),
        content: [{ type: 'tool_use', id, name, input }],
      },
    }),
  }
}

function result(
  ctx: Ctx,
  target: DemoStep['target'],
  id: string,
  toolUseResult: unknown,
  seconds = 1,
): DemoStep {
  return {
    target,
    line: envelope(ctx, target, seconds, {
      type: 'user',
      userType: 'external',
      toolUseResult,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, is_error: null, content: 'ok' }],
      },
    }),
  }
}

/**
 * El guion. Se parte en dos: lo que ya está escrito cuando se abre el visor (para que el
 * mundo arranque con historia) y lo que se va escribiendo con el navegador abierto, que es
 * lo que se ve moverse — incluidos los dos subagentes.
 */
export function buildDemoScript(startedAt: number): { past: DemoStep[]; live: DemoStep[] } {
  const ctx: Ctx = { ts: startedAt, parent: { main: null } }

  const past: DemoStep[] = [
    prompt(
      ctx,
      'main',
      'Añade paginación por cursor al listado de pedidos y cubre el caso de página vacía con un test.',
    ),
    thinking(
      ctx,
      'main',
      'Primero miro cómo está montado el listado y qué convención siguen los tests del proyecto.',
    ),
    call(ctx, 'main', 'toolu_d01', 'Read', { file_path: `${CWD}/src/routes/orders.ts` }),
    result(ctx, 'main', 'toolu_d01', { type: 'text', file: { numLines: 148 } }),
    call(ctx, 'main', 'toolu_d02', 'Grep', { pattern: 'findMany', path: 'src' }),
    result(ctx, 'main', 'toolu_d02', { matches: ['src/routes/orders.ts:61', 'src/routes/items.ts:24'] }),
    say(
      ctx,
      'main',
      'El listado usa Prisma sin paginar. Añado cursor y límite, y de paso un test del caso vacío.',
    ),
    call(ctx, 'main', 'toolu_d03', 'Bash', {
      command: 'npm test -- orders',
      description: 'Ejecutar los tests de pedidos',
    }),
    result(ctx, 'main', 'toolu_d03', {
      stdout: '12 passing (1.4s)\n1 pending',
      stderr: '',
      interrupted: false,
    }),
    call(ctx, 'main', 'toolu_d04', 'TaskCreate', {
      subject: 'Paginar el listado de pedidos',
      description: 'Cursor, límite y test del caso vacío',
    }),
    result(ctx, 'main', 'toolu_d04', { tasks: [{ id: '1', status: 'pending' }] }),
  ]

  const live: DemoStep[] = [
    // Dos subagentes en paralelo: el tool_result trae el agentId, que es lo que hace nacer
    // al avatar en el mundo.
    call(ctx, 'main', 'toolu_d05', 'Agent', {
      subagent_type: 'Explore',
      description: 'Buscar convenciones de paginación',
      prompt: 'Busca si el proyecto ya pagina en algún endpoint y con qué convención.',
    }),
    result(ctx, 'main', 'toolu_d05', {
      isAsync: true,
      status: 'async_launched',
      agentId: AGENT_EXPLORE,
      description: 'Buscar convenciones de paginación',
      resolvedModel: MODEL,
    }),
    call(ctx, 'main', 'toolu_d06', 'Agent', {
      subagent_type: 'Plan',
      description: 'Diseñar el contrato del endpoint',
      prompt: 'Diseña el contrato del listado paginado sin romper a los clientes actuales.',
    }),
    result(ctx, 'main', 'toolu_d06', {
      isAsync: true,
      status: 'async_launched',
      agentId: AGENT_PLAN,
      description: 'Diseñar el contrato del endpoint',
      resolvedModel: MODEL,
    }),

    call(ctx, 'main', 'toolu_d13', 'Agent', {
      subagent_type: 'Explore',
      description: 'Revisar los tests de pedidos',
      prompt: 'Mira qué cubren hoy los tests de pedidos y qué convención siguen.',
    }),
    result(ctx, 'main', 'toolu_d13', {
      isAsync: true,
      status: 'async_launched',
      agentId: AGENT_EXPLORE2,
      description: 'Revisar los tests de pedidos',
      resolvedModel: MODEL,
    }),

    prompt(ctx, AGENT_EXPLORE, 'Busca si el proyecto ya pagina en algún endpoint.', 0.5),
    thinking(ctx, AGENT_EXPLORE, 'Rastreo por «cursor», «take» y «skip» en las rutas.', 1),
    call(ctx, AGENT_EXPLORE, 'toolu_e01', 'Grep', { pattern: 'cursor|take|skip', path: 'src' }, 1),

    prompt(ctx, AGENT_PLAN, 'Diseña el contrato del listado paginado.', 0.5),
    thinking(ctx, AGENT_PLAN, 'Si añado el cursor como opcional, los clientes actuales no se enteran.', 1),
    call(ctx, AGENT_PLAN, 'toolu_p01', 'Read', { file_path: `${CWD}/docs/api.md` }, 1),

    result(ctx, AGENT_EXPLORE, 'toolu_e01', { matches: ['src/routes/items.ts:24'] }, 1),
    call(ctx, AGENT_EXPLORE, 'toolu_e02', 'Read', { file_path: `${CWD}/src/routes/items.ts` }, 1),
    result(ctx, AGENT_PLAN, 'toolu_p01', { type: 'text', file: { numLines: 96 } }, 1),

    prompt(ctx, AGENT_EXPLORE2, 'Mira qué cubren hoy los tests de pedidos.', 0.5),
    thinking(ctx, AGENT_EXPLORE2, 'Busco los ficheros de test y qué casos tocan.', 1),
    call(ctx, AGENT_EXPLORE2, 'toolu_x01', 'Glob', { pattern: 'test/**/*orders*' }, 1),
    result(ctx, AGENT_EXPLORE2, 'toolu_x01', { numFiles: 3 }, 1),
    call(ctx, AGENT_EXPLORE2, 'toolu_x02', 'Read', { file_path: `${CWD}/test/orders.test.ts` }, 1),

    call(ctx, 'main', 'toolu_d07', 'mcp__postgres__query', {
      sql: 'select count(*) from orders',
    }, 1),
    result(ctx, 'main', 'toolu_d07', { content: [{ type: 'text', text: '41 820' }] }),

    result(ctx, AGENT_EXPLORE, 'toolu_e02', { type: 'text', file: { numLines: 74 } }, 1),
    say(ctx, AGENT_EXPLORE, 'items.ts ya pagina con `?cursor=` y `?limit=`; conviene copiar esa forma.', 1),
    say(ctx, AGENT_PLAN, 'Cursor opcional y `limit` con techo de 100: compatible con los clientes de hoy.', 1),
    result(ctx, AGENT_EXPLORE2, 'toolu_x02', { type: 'text', file: { numLines: 132 } }, 1),
    say(ctx, AGENT_EXPLORE2, 'Los tests cubren el listado completo, pero ninguno prueba la página vacía.', 1),

    call(ctx, 'main', 'toolu_d08', 'Edit', {
      file_path: `${CWD}/src/routes/orders.ts`,
      old_string: 'const orders = await prisma.order.findMany()',
      new_string: 'const orders = await prisma.order.findMany({ take: limit, cursor })',
    }, 1),
    result(ctx, 'main', 'toolu_d08', {
      structuredPatch: [
        { lines: ['+  const limit = Math.min(Number(req.query.limit ?? 20), 100)', '+  const cursor = req.query.cursor', '-  const orders = await prisma.order.findMany()'] },
      ],
    }),
    call(ctx, 'main', 'toolu_d09', 'Skill', {
      skill: 'test-writer',
      args: 'test del listado de pedidos con página vacía y cursor inválido',
    }, 1),
    result(ctx, 'main', 'toolu_d09', { content: [{ type: 'text', text: 'skill cargada' }] }),
    call(ctx, 'main', 'toolu_d10', 'Write', {
      file_path: `${CWD}/test/orders.pagination.test.ts`,
      content: '// test de paginación\n',
    }, 1),
    result(ctx, 'main', 'toolu_d10', { type: 'create', filePath: `${CWD}/test/orders.pagination.test.ts` }),
    call(ctx, 'main', 'toolu_d11', 'WebSearch', { query: 'prisma cursor pagination edge cases' }, 1),
    result(ctx, 'main', 'toolu_d11', { content: [{ type: 'text', text: '5 resultados' }] }),
    call(ctx, 'main', 'toolu_d12', 'Bash', { command: 'npm test', description: 'Suite completa' }, 1),
    result(ctx, 'main', 'toolu_d12', { stdout: '19 passing (2.1s)', stderr: '', interrupted: false }),
    say(ctx, 'main', 'Listo: cursor y límite en el listado, y un test que cubre la página vacía.', 1),
  ]

  return { past, live }
}

/** starttime (campo 22) de /proc/self/stat, para que el visor valide el PID. */
async function selfProcStart(): Promise<string | undefined> {
  try {
    const stat = await readFile('/proc/self/stat', 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
    return fields[19]
  } catch {
    return undefined
  }
}

/**
 * Sesiones «de otros días» en otros proyectos: solo ficheros de transcript, sin roster, para
 * que el histórico tenga varios proyectos que agrupar en el árbol. Cada una son cuatro líneas,
 * lo justo para que el índice saque proyecto, título, rama, modelo y fechas.
 */
const ARCHIVE: { cwd: string; branch: string; titles: string[] }[] = [
  {
    cwd: '/home/demo/proyectos/tienda-api',
    branch: 'main',
    titles: ['Migrar los pedidos a cursor', 'Revisar los índices de Postgres', 'Subir el SDK a la v3'],
  },
  {
    cwd: '/home/demo/proyectos/web-clientes',
    branch: 'rediseño',
    titles: ['Rehacer la ficha de cliente', 'Quitar el bundle de iconos'],
  },
  {
    cwd: '/home/demo/infra',
    branch: 'main',
    titles: ['Rotar los certificados', 'Alertas de disco en los nodos', 'Presupuesto del clúster'],
  },
  { cwd: '/home/demo/notas', branch: 'main', titles: ['Ordenar las notas de la semana'] },
]

/**
 * Guion breve de una conversación del histórico. Antes eran dos líneas —lo justo para que el
 * índice sacara el título—, y al abrirla el reproductor terminaba antes de empezar: no había nada
 * que reproducir. Con esto cada una tiene su petición, su razonamiento y unas cuantas
 * herramientas, así que se pueden mirar como una película.
 */
function archiveScript(
  ctx: Ctx,
  title: string,
  flavour: number,
): DemoStep[] {
  const steps: DemoStep[] = [
    prompt(ctx, 'main', title),
    thinking(ctx, 'main', 'Antes de tocar nada, miro cómo está montado esto ahora mismo.'),
  ]
  // Cuatro sabores para que las conversaciones no salgan todas iguales.
  const recipes: ((n: number) => DemoStep[])[] = [
    (n) => [
      call(ctx, 'main', `a${n}1`, 'Grep', { pattern: 'export function', path: 'src' }),
      result(ctx, 'main', `a${n}1`, { matches: ['src/index.ts:12', 'src/util.ts:40'] }),
      call(ctx, 'main', `a${n}2`, 'Read', { file_path: 'src/index.ts' }),
      result(ctx, 'main', `a${n}2`, { type: 'text', file: { numLines: 214 } }),
      call(ctx, 'main', `a${n}3`, 'Edit', { file_path: 'src/index.ts' }),
      result(ctx, 'main', `a${n}3`, {
        structuredPatch: [{ lines: ['+ const limit = 100', '- const limit = 20'] }],
      }),
    ],
    (n) => [
      call(ctx, 'main', `a${n}1`, 'Bash', { command: 'npm test', description: 'Pasar los tests' }),
      result(ctx, 'main', `a${n}1`, { stdout: '31 passing (2.4s)', stderr: '', interrupted: false }),
      call(ctx, 'main', `a${n}2`, 'Bash', { command: 'git status --short' }),
      result(ctx, 'main', `a${n}2`, { stdout: ' M src/index.ts', stderr: '', interrupted: false }),
    ],
    (n) => [
      call(ctx, 'main', `a${n}1`, 'WebSearch', { query: 'cursor pagination best practices' }),
      result(ctx, 'main', `a${n}1`, { results: [{ title: 'Cursors' }, { title: 'Keyset' }] }),
      call(ctx, 'main', `a${n}2`, 'Write', { file_path: 'docs/decision.md' }),
      result(ctx, 'main', `a${n}2`, { type: 'create', filePath: 'docs/decision.md' }),
      call(ctx, 'main', `a${n}3`, 'TaskCreate', { subject: title }),
      result(ctx, 'main', `a${n}3`, { tasks: [{ id: '1' }] }),
    ],
    (n) => [
      call(ctx, 'main', `a${n}1`, 'Read', { file_path: 'infra/nodes.yaml' }),
      result(ctx, 'main', `a${n}1`, { type: 'text', file: { numLines: 96 } }),
      call(ctx, 'main', `a${n}2`, 'Bash', { command: 'kubectl get nodes' }),
      result(ctx, 'main', `a${n}2`, { stdout: 'node-1 Ready\nnode-2 Ready', stderr: '', interrupted: false }),
      call(ctx, 'main', `a${n}3`, 'Bash', { command: 'terraform plan' }),
      result(ctx, 'main', `a${n}3`, { stdout: 'No changes.', stderr: '', interrupted: false }),
    ],
  ]
  steps.push(...recipes[flavour % recipes.length]!(flavour))
  steps.push(say(ctx, 'main', 'Listo. Te dejo el resumen de lo que he cambiado y por qué.'))
  return steps
}

/** Escribe el histórico ficticio. Devuelve cuántas sesiones ha dejado en disco. */
async function writeArchive(dir: string, endedAt: number): Promise<number> {
  let written = 0
  for (const [p, project] of ARCHIVE.entries()) {
    const slug = project.cwd.replace(/[^a-zA-Z0-9]/g, '-')
    await mkdir(join(dir, 'projects', slug), { recursive: true })
    for (const [t, title] of project.titles.entries()) {
      // Fechas escalonadas hacia atrás: días distintos por proyecto y por sesión.
      const started = endedAt - ((p + 1) * 3 + t) * 86_400_000
      const sessionId = `dec0de00-0000-4000-8000-1${p}${t}000000000`.slice(0, 36)
      const ctx: Ctx = {
        ts: started,
        parent: { main: null },
        sessionId,
        cwd: project.cwd,
        branch: project.branch,
      }
      const lines: Record<string, unknown>[] = [
        ...archiveScript(ctx, title, p * 3 + t).map((step) => step.line),
        { type: 'ai-title', aiTitle: title, sessionId },
      ]
      await writeFile(
        join(dir, 'projects', slug, `${sessionId}.jsonl`),
        `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
        'utf8',
      )
      written++
    }
  }
  return written
}

/**
 * Jobs en segundo plano de la demostración: seis, uno más de los que caben en el Campamento,
 * para retratar también el «y 1 más» del cartel. El que se declara trabajando sin proceso
 * detrás sale como residuo, que es un caso real y frecuente.
 */
const DEMO_JOBS: {
  id: string
  state: string
  name: string
  intent: string
  detail: string
  cwd: string
  result?: string
}[] = [
  {
    id: 'a1b2c3d4',
    state: 'working',
    name: 'Migrar los informes a la cola nueva',
    intent: 'Pasa los informes nocturnos a la cola nueva y deja los dos convirtiendo mientras',
    detail: 'Reescribiendo el consumidor; 3 de 7 informes migrados',
    cwd: '/home/demo/proyectos/tienda-api',
  },
  {
    id: 'b2c3d4e5',
    state: 'blocked',
    name: 'Subir la versión del SDK',
    intent: 'Sube el SDK a la v3 y arregla lo que rompa',
    detail: 'Necesito permiso para publicar el paquete',
    cwd: '/home/demo/proyectos/web-clientes',
  },
  {
    id: 'c3d4e5f6',
    state: 'done',
    name: 'Rotar los certificados',
    intent: 'Rota los certificados de los nodos y comprueba que renuevan solos',
    detail: 'Hecho',
    result: 'Cuatro nodos rotados, renovación automática verificada',
    cwd: '/home/demo/infra',
  },
  {
    id: 'd4e5f6a7',
    state: 'failed',
    name: 'Limpiar el caché de imágenes',
    intent: 'Vacía el caché de imágenes de producción',
    detail: 'El bucket respondió 403: falta el rol de escritura',
    cwd: '/home/demo/infra',
  },
  {
    id: 'e5f6a7b8',
    state: 'working',
    name: 'Repasar las notas de la semana',
    intent: 'Ordena las notas y saca una lista de pendientes',
    detail: 'Leyendo las notas del martes',
    cwd: '/home/demo/notas',
  },
  {
    id: 'f6a7b8c9',
    state: 'done',
    name: 'Presupuesto del clúster',
    intent: 'Calcula el coste del clúster con los nodos nuevos',
    detail: 'Hecho',
    result: '412 €/mes con los tres nodos nuevos',
    cwd: '/home/demo/infra',
  },
]

/**
 * Escribe los jobs de la demostración y un roster de daemon que los avala.
 *
 * Sin roster, un job que se declara «trabajando» se muestra como residuo —y con razón: eso es
 * lo que hace el visor cuando no hay proceso detrás—. Aquí se apunta el PID de este proceso,
 * que está vivo mientras dura la demostración, así que se ven los dos casos: los que trabajan
 * de verdad y los que solo lo dicen.
 */
async function writeJobs(dir: string, now: number): Promise<number> {
  const workers: Record<string, unknown> = {}
  const procStart = await selfProcStart()
  for (const [index, job] of DEMO_JOBS.entries()) {
    if (job.state !== 'working' && job.state !== 'blocked') continue
    workers[job.id] = {
      pid: process.pid,
      procStart,
      // El mismo que escribe su state.json: si no coinciden, el visor no puede emparejar la
      // sesión de background con su job.
      sessionId: `dec0de00-0000-4000-8000-9${index}00000000000`.slice(0, 36),
      cwd: job.cwd,
      cliVersion: '2.1.220',
      startedAt: now,
    }
  }
  await mkdir(join(dir, 'daemon'), { recursive: true })
  await writeFile(
    join(dir, 'daemon', 'roster.json'),
    JSON.stringify({ proto: 1, supervisorPid: process.pid, updatedAt: now, workers }, null, 2),
    'utf8',
  )

  for (const [index, job] of DEMO_JOBS.entries()) {
    const jobDir = join(dir, 'jobs', job.id)
    await mkdir(jobDir, { recursive: true })
    const created = new Date(now - (index + 1) * 3_600_000).toISOString()
    const updated = new Date(now - index * 600_000).toISOString()
    await writeFile(
      join(jobDir, 'state.json'),
      JSON.stringify(
        {
          state: job.state,
          detail: job.detail,
          intent: job.intent,
          name: job.name,
          nameSource: 'auto',
          template: 'bg',
          output: job.result ? { result: job.result } : null,
          sessionId: `dec0de00-0000-4000-8000-9${index}00000000000`.slice(0, 36),
          daemonShort: job.id,
          cwd: job.cwd,
          createdAt: created,
          updatedAt: updated,
          backend: 'daemon',
        },
        null,
        2,
      ),
      'utf8',
    )
  }
  return DEMO_JOBS.length
}

/**
 * `history.jsonl` es el registro de prompts, y sobrevive a la limpieza de transcripts: de ahí
 * saca el visor cuántas sesiones has tenido de verdad. Aquí se escriben unas cuantas de las que
 * ya no queda transcript, para que el aviso de retención tenga algo que contar.
 */
async function writeHistoryLog(dir: string): Promise<number> {
  const rows: string[] = []
  // Las que sí existen, con su prompt.
  rows.push(JSON.stringify({ display: 'Añade paginación por cursor', sessionId: SESSION_ID }))
  for (const [p, project] of ARCHIVE.entries()) {
    for (const [t, title] of project.titles.entries()) {
      rows.push(
        JSON.stringify({
          display: title,
          sessionId: `dec0de00-0000-4000-8000-1${p}${t}000000000`.slice(0, 36),
        }),
      )
    }
  }
  // Y las olvidadas: mismo formato, con ids que ya no están en disco.
  const forgotten = 28
  for (let i = 0; i < forgotten; i++) {
    rows.push(
      JSON.stringify({
        display: `una conversación de hace tiempo (${i + 1})`,
        sessionId: `dec0de00-0000-4000-8000-f${String(i).padStart(2, '0')}00000000000`.slice(0, 36),
      }),
    )
  }
  await writeFile(join(dir, 'history.jsonl'), `${rows.join('\n')}\n`, 'utf8')
  return forgotten
}

export interface DemoWorld {
  dir: string
  transcript: string
  subagentDir: string
  sessionId: string
}

/** Prepara el árbol de ficheros y escribe la parte «ya ocurrida» del guion. */
export async function writeDemoWorld(dir: string, past: DemoStep[]): Promise<DemoWorld> {
  const projectDir = join(dir, 'projects', SLUG)
  const subagentDir = join(projectDir, SESSION_ID, 'subagents')
  await mkdir(subagentDir, { recursive: true })
  await mkdir(join(dir, 'sessions'), { recursive: true })

  const archived = await writeArchive(dir, Date.now())
  console.log(`  histórico ficticio: ${archived} sesiones en ${ARCHIVE.length} proyectos`)
  const jobCount = await writeJobs(dir, Date.now())
  console.log(`  jobs en segundo plano: ${jobCount}`)
  const forgotten = await writeHistoryLog(dir)
  console.log(`  registro de prompts: ${forgotten} sesiones de las que ya no queda transcript`)

  const transcript = join(projectDir, `${SESSION_ID}.jsonl`)
  await writeFile(transcript, '', 'utf8')
  await writeFile(
    transcript,
    `${past.map((step) => JSON.stringify(step.line)).join('\n')}\n`,
    'utf8',
  )
  // El título legible de la sesión viaja como un evento más del transcript.
  await appendFile(
    transcript,
    `${JSON.stringify({ type: 'ai-title', aiTitle: 'Paginar el listado de pedidos', sessionId: SESSION_ID })}\n`,
    'utf8',
  )
  await appendFile(
    transcript,
    `${JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: SESSION_ID })}\n`,
    'utf8',
  )

  // Roster: el PID es el de este proceso, que está vivo mientras dura la demo.
  await writeFile(
    join(dir, 'sessions', `${process.pid}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: SESSION_ID,
      cwd: CWD,
      startedAt: Date.now(),
      procStart: await selfProcStart(),
      version: '2.1.220',
      kind: 'interactive',
      entrypoint: 'cli',
      name: 'tienda-api',
      status: 'busy',
      updatedAt: Date.now(),
    }),
    'utf8',
  )

  return { dir, transcript, subagentDir, sessionId: SESSION_ID }
}

/** Escribe un paso del guion en su fichero, creando el del subagente si hace falta. */
export async function playStep(world: DemoWorld, step: DemoStep): Promise<void> {
  if (step.target === 'main') {
    await appendFile(world.transcript, `${JSON.stringify(step.line)}\n`, 'utf8')
    return
  }

  const agentId = step.target
  const meta = join(world.subagentDir, `agent-${agentId}.meta.json`)
  const path = join(world.subagentDir, `agent-${agentId}.jsonl`)
  const perAgent: Record<string, { agentType: string; description: string; toolUseId: string }> = {
    [AGENT_EXPLORE]: {
      agentType: 'Explore',
      description: 'Buscar convenciones de paginación',
      toolUseId: 'toolu_d05',
    },
    [AGENT_EXPLORE2]: {
      agentType: 'Explore',
      description: 'Revisar los tests de pedidos',
      toolUseId: 'toolu_d13',
    },
    [AGENT_PLAN]: {
      agentType: 'Plan',
      description: 'Diseñar el contrato del endpoint',
      toolUseId: 'toolu_d06',
    },
  }
  await writeFile(meta, JSON.stringify({ ...perAgent[agentId], spawnDepth: 1 }), 'utf8')
  await appendFile(path, `${JSON.stringify(step.line)}\n`, 'utf8')
}
