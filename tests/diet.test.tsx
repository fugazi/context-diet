import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { DietHistory, DietReport } from '../types'
import { DAY, NOW, STARTED, pastSession, usageFixture } from './fixtures'

const HISTORY_KEY = 'history-1'
const PANE = {
  plugin: 'context-diet',
  component: 'Pane',
  requestId: 'context-diet',
  props: {
    title: 'Context Diet',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'context-diet',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

type World = {
  usageCalls: unknown[]
  files: Record<string, string>
  store: Map<string, unknown>
}

/** Lo que hay debajo del mod: cada hook aquí hace de motor. */
function world(on: On, options: { store?: Record<string, unknown>; tokens?: number } = {}): World {
  const seen: World = {
    usageCalls: [],
    store: new Map(Object.entries(options.store ?? {})),
    files: {
      '/home/u/.claude.json': JSON.stringify({
        mcpServers: { firecrawl: { command: 'x', env: { API_KEY: 'sk-secreto' } } },
        projects: { '/work': { mcpServers: { 'brave-search': { command: 'y' } } } },
      }),
      '/work/.mcp.json': JSON.stringify({ mcpServers: { ableton: { command: 'z' } } }),
    },
  }
  mock.env(on, { HOME: '/home/u' })
  // Un store propio en memoria, para poder leer lo que el mod guardó.
  on('store.get', (_, e) => ({ value: seen.store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const write = e as { key: string; value: unknown }
    seen.store.set(write.key, JSON.parse(JSON.stringify(write.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    seen.store.delete((e as { key: string }).key)
    return { value: undefined }
  })
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'diet' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.usage', (_, e) => {
    seen.usageCalls.push(e)
    return { value: usageFixture({ tokens: options.tokens ?? 38100 }) }
  })
  on('fs.read', (_, e) => {
    const text = seen.files[(e as { path: string }).path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', (_, e) => (String(e.tool).endsWith('__crawl') ? { result: {}, isError: true } : { result: {} }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return seen
}

const start = ($: { session: { start: (e: never) => Promise<unknown> } }) =>
  $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)

/** Corre `/diet <args>` como lo haría la persona; el motor sella el resto. */
const diet = ($: { command: { run: (e: never) => Promise<{ text?: string }> } }, args: string) =>
  $.command.run({ command: 'diet', args } as never)

const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' }

test('/diet imprime el resumen con el desglose real y no lee secretos', async ($, on) => {
  const seen = world(on)
  await start($)

  const text = (await diet($, '')).text ?? ''
  expect(text).toContain('en uso      38.1k / 200k (19%)')
  expect(text).toMatch(/OBSERVAR\s+firecrawl \[user\] · 8k cargados \(2\/3 tools\)/)
  expect(text).toContain('sin costo ni uso: brave-search')
  expect(text).toMatch(/SIN TOOLS\s+ableton \[project\]/)
  expect(text).toContain('APP DE CLAUDE Y PLUGINS · 1 servers')
  expect(text).toMatch(/faltan 3 sesión\(es\) de historial/)
  expect(text).not.toContain('sk-secreto')
  // Pide el desglose local, sin requests a la API de conteo.
  expect(seen.usageCalls).toContainEqual({ breakdown: 'summary' })

  // `projects[cwd]` de ~/.claude.json es el scope local; `.mcp.json`, project.
  const all = (await diet($, '--all')).text ?? ''
  expect(all).toMatch(/brave-search \[local\] · 0 cargados/)
  expect(all).toMatch(/FIJO\s+ccd_session \[host\]/)
})

test('/diet --json es parseable y los argumentos desconocidos muestran la ayuda', async ($, on) => {
  world(on)
  await start($)

  const report = JSON.parse((await diet($, '--json')).text ?? '') as DietReport
  expect(report.cwd).toBe('/work')
  expect(report.servers.map(server => server.name)).toEqual([
    'firecrawl',
    'ccd_session',
    'claude_ai_Docs',
    'brave-search',
    'ableton',
  ])
  expect(JSON.stringify(report)).not.toContain('sk-secreto')

  expect((await diet($, 'nope')).text).toMatch(/Argumento desconocido[\s\S]*\/diet panel/)
  expect((await diet($, 'banda')).text).toBe('Uso: /diet banda on|off')
})

test('cuenta llamadas MCP con sus errores, subagentes y skills', async ($, on) => {
  world(on)
  await start($)

  await $.tool.call({ tool: 'mcp__firecrawl__scrape' } as never)
  await $.tool.call({ tool: 'mcp__firecrawl__crawl' } as never)
  await $.tool.call({ tool: 'Agent', subagent_type: 'reviewer', description: 'd', prompt: 'p' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.skill.prompt({ skill: 'tdd', text: 'x', frontmatter: {}, source: 'plugin', pluginName: 'agent-skills' } as never)
  await $.skill.prompt({ skill: 'ctx', text: 'x', frontmatter: {}, source: 'userSettings' } as never)

  const report = JSON.parse((await diet($, '--json')).text ?? '') as DietReport
  const firecrawl = report.servers.find(server => server.name === 'firecrawl')
  expect([firecrawl?.calls, firecrawl?.errors, firecrawl?.verdict]).toEqual([2, 1, 'used'])
  expect(report.agents[0]?.calls).toBe(1)
  const loads = Object.fromEntries(report.skillGroups.map(group => [group.key, group.loads]))
  expect(loads).toEqual({ 'plugin:agent-skills': 1, 'built-in': 0, 'skill:ctx': 1, 'skill:notes': 0 })
})

test('el historial se guarda al cerrar un turno y produce candidatos', async ($, on) => {
  const store: DietHistory = { sessions: { a: pastSession(1), b: pastSession(2) } }
  const seen = world(on, { store: { [HISTORY_KEY]: store } })
  const saved = () => seen.store.get(HISTORY_KEY) as DietHistory
  await start($)

  // Antes de un turno la sesión no es evidencia ni se escribe nada.
  expect((await diet($, '')).text).toMatch(/OBSERVAR\s+firecrawl/)
  expect(Object.keys(saved().sessions)).toEqual(['a', 'b'])

  await $.tool.call({ tool: 'mcp__brave-search__web' } as never)
  await $.turn.complete(TURN as never)

  expect(Object.keys(saved().sessions).sort()).toEqual([String(STARTED), 'a', 'b'].sort())
  expect(saved().sessions[String(STARTED)]?.servers['brave-search']?.calls).toBe(1)

  const text = (await diet($, '')).text ?? ''
  expect(text).toMatch(/CANDIDATO\s+firecrawl[^\n]*usado en 0\/3 sesiones/)
  expect(text).toMatch(/USADO\s+brave-search/)
  expect(text).toContain('claude mcp remove -s user firecrawl   # −8k')
  expect(text).toMatch(/claude plugin disable agent-skills/)
})

test('un turno de subagente no cuenta como turno de la sesión', async ($, on) => {
  world(on)
  await start($)
  await $.turn.complete({ ...TURN, agentId: 'a1' } as never)
  const report = JSON.parse((await diet($, '--json')).text ?? '') as DietReport
  expect(report.turns).toBe(0)
})

test('/diet reset borra el historial', async ($, on) => {
  world(on, { store: { [HISTORY_KEY]: { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } } } })
  await start($)
  expect((await diet($, '')).text).toMatch(/CANDIDATO\s+firecrawl/)
  expect((await diet($, 'reset')).text).toMatch(/historial borrado/)
  expect((await diet($, '')).text).toMatch(/OBSERVAR\s+firecrawl/)
})

test('la banda calla sin nada que hacer, avisa con candidatos y se puede apagar', async ($, on) => {
  const seen = world(on)
  await start($)
  await diet($, '')

  const quiet = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await quiet.find({ text: /diet/ })).toBe(undefined)
  await quiet.unmount()

  seen.store.set(HISTORY_KEY, { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } })
  await diet($, '')
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /candidatos/ }))?.text).toBe(
      '● diet 6 candidatos a apagar · −10.7k por request · /diet',
    )
    await band.unmount()
  }

  expect((await diet($, 'banda off')).text).toMatch(/apagados/)
  expect(seen.store.get('band')).toBe(false)
  const off = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await off.find({ text: /candidatos/ })).toBe(undefined)
  await off.unmount()
  expect((await diet($, 'banda on')).text).toMatch(/activados/)
})

test('la fila de /diet se dibuja como etiqueta; una fila vieja queda como texto', async ($, on) => {
  world(on, { store: { [HISTORY_KEY]: { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } } } })
  await start($)
  const text = (await diet($, '')).text ?? ''
  const ROW = { plugin: 'context-diet', component: 'CommandOutput', requestId: 'm1' } as const
  const props = { command: 'diet', args: '', text, isErrored: false }

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...ROW, props, surface })
    expect(await ui.find({ type: 'Text', text: /^Context Diet$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^~30\.3k$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /firecrawl.*8k.*CANDIDATO/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /App de Claude y plugins \(1\).* 1k .*FIJO/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /claude mcp remove -s user firecrawl/ })).toBeDefined()
    // El resumen no lista lo de la app; --all sí.
    expect(await ui.find({ type: 'Text', text: /ccd_session/ })).toBe(undefined)
    await ui.unmount()
  }

  const all = await $.ui.mount({ ...ROW, props: { ...props, args: '--all' }, surface: 'terminal' })
  expect(await all.find({ type: 'Text', text: /ccd_session/ })).toBeDefined()
  await all.unmount()

  // Otro texto (una fila anterior, la ayuda, el JSON) no es de este reporte.
  const old = await $.ui.mount({ ...ROW, props: { ...props, text: 'Context Diet · 2020-01-01 00:00:00 UTC' }, surface: 'terminal' })
  expect(await old.find({ type: 'Text', text: /^Context Diet$/ })).toBe(undefined)
  await old.unmount()
})

test('el historial viejo o corrupto no rompe el reporte', async ($, on) => {
  world(on, { store: { [HISTORY_KEY]: { sessions: { viejo: pastSession(90), roto: 'x' } } } })
  await start($)
  const report = JSON.parse((await diet($, '--json')).text ?? '') as DietReport
  expect(report.history.sessions).toBe(0)
  expect(NOW - 90 * DAY).toBeLessThan(NOW)
})

test('el panel dibuja la etiqueta en cada superficie y se actualiza', async ($, on) => {
  world(on, { store: { [HISTORY_KEY]: { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } } } })
  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') {
      // Sin medición todavía: el botón la dispara.
      expect((await ui.find({ type: 'Text', text: /Sin medición/ }))?.text).toBe('Sin medición todavía.')
      await ui.press({ key: 'refresh' })
    }
    expect(await ui.find({ type: 'Text', text: /^Context Diet$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /firecrawl.*CANDIDATO/ })).toBeDefined()
    // El panel es el resumen: lo de la app va agregado en una fila.
    expect(await ui.find({ type: 'Text', text: /ccd_session/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /App de Claude y plugins \(1\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /claude mcp remove -s user firecrawl/ })).toBeDefined()
    await ui.unmount()
  }

  expect((await diet($, 'panel')).text).toBe('Context Diet: panel abierto.')
})
