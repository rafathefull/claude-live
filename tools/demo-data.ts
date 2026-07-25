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
const AGENT_PLAN = 'b22df00plan00002'

/** Un paso del guion: en qué fichero cae y qué línea se escribe. */
export interface DemoStep {
  target: 'main' | typeof AGENT_EXPLORE | typeof AGENT_PLAN
  line: Record<string, unknown>
}

interface Ctx {
  ts: number
  parent: Record<string, string | null>
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
    sessionId: SESSION_ID,
    cwd: CWD,
    gitBranch: 'main',
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

    prompt(ctx, AGENT_EXPLORE, 'Busca si el proyecto ya pagina en algún endpoint.', 0.5),
    thinking(ctx, AGENT_EXPLORE, 'Rastreo por «cursor», «take» y «skip» en las rutas.', 1),
    call(ctx, AGENT_EXPLORE, 'toolu_e01', 'Grep', { pattern: 'cursor|take|skip', path: 'src' }, 1),

    prompt(ctx, AGENT_PLAN, 'Diseña el contrato del listado paginado.', 0.5),
    thinking(ctx, AGENT_PLAN, 'Si añado el cursor como opcional, los clientes actuales no se enteran.', 1),
    call(ctx, AGENT_PLAN, 'toolu_p01', 'Read', { file_path: `${CWD}/docs/api.md` }, 1),

    result(ctx, AGENT_EXPLORE, 'toolu_e01', { matches: ['src/routes/items.ts:24'] }, 1),
    call(ctx, AGENT_EXPLORE, 'toolu_e02', 'Read', { file_path: `${CWD}/src/routes/items.ts` }, 1),
    result(ctx, AGENT_PLAN, 'toolu_p01', { type: 'text', file: { numLines: 96 } }, 1),

    call(ctx, 'main', 'toolu_d07', 'mcp__postgres__query', {
      sql: 'select count(*) from orders',
    }, 1),
    result(ctx, 'main', 'toolu_d07', { content: [{ type: 'text', text: '41 820' }] }),

    result(ctx, AGENT_EXPLORE, 'toolu_e02', { type: 'text', file: { numLines: 74 } }, 1),
    say(ctx, AGENT_EXPLORE, 'items.ts ya pagina con `?cursor=` y `?limit=`; conviene copiar esa forma.', 1),
    say(ctx, AGENT_PLAN, 'Cursor opcional y `limit` con techo de 100: compatible con los clientes de hoy.', 1),

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
  const isExplore = agentId === AGENT_EXPLORE
  await writeFile(
    meta,
    JSON.stringify({
      agentType: isExplore ? 'Explore' : 'Plan',
      description: isExplore ? 'Buscar convenciones de paginación' : 'Diseñar el contrato del endpoint',
      toolUseId: isExplore ? 'toolu_d05' : 'toolu_d06',
      spawnDepth: 1,
    }),
    'utf8',
  )
  await appendFile(path, `${JSON.stringify(step.line)}\n`, 'utf8')
}
