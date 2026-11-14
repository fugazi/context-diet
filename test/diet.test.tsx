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

type World = {
  statuses: (string | undefined)[]
  usageCalls: unknown[]
  files: Record<string, string>
  store: Map<string, unknown>
}

/** Lo que hay debajo del mod: cada hook aquí hace de motor. */
function world(on: On, options: { store?: Record<string, unknown>; tokens?: number } = {}): World {
  const seen: World = {
    statuses: [],
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
  on('ui.status', (_, e) => {
    seen.statuses.push((e as { text?: string }).text)
    return { value: undefined }
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

test('/diet imprime el reporte con el desglose real y no lee secretos', async ($, on) => {
  const seen = world(on)
  await start($)

  const ran = await diet($, '')
  expect(ran.text).toContain('38.1k / 200k (19%)')
  expect(ran.text).toMatch(/OBSERVAR\s+firecrawl \[user\] · 8k cargados \(2\/3 tools\)/)
  // `projects[cwd]` de ~/.claude.json es el scope local; `.mcp.json`, project.
  expect(ran.text).toMatch(/brave-search \[local\] · 0 cargados/)
  expect(ran.text).toMatch(/SIN TOOLS\s+ableton \[project\]/)
  expect(ran.text).toMatch(/faltan 3 sesión\(es\) de historial/)
  expect(ran.text).not.toContain('sk-secreto')
  // Pide el desglose local, sin requests a la API de conteo.
  expect(seen.usageCalls).toContainEqual({ breakdown: 'summary' })
  expect(seen.statuses.at(-1)).toBe('diet 19% · fijo 30.3k')
})

test('/diet --json es parseable y los argumentos desconocidos muestran la ayuda', async ($, on) => {
  world(on)
  await start($)

  const report = JSON.parse((await diet($, '--json')).text ?? '') as DietReport
  expect(report.cwd).toBe('/work')
  expect(report.servers.map(server => server.name)).toEqual(['firecrawl', 'claude_ai_Docs', 'brave-search', 'ableton'])
  expect(JSON.stringify(report)).not.toContain('sk-secreto')

  expect((await diet($, 'nope')).text).toMatch(/Argumento desconocido[\s\S]*\/diet panel/)
  expect((await diet($, 'status')).text).toBe('Uso: /diet status on|off')
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
  expect(seen.statuses.at(-1)).toMatch(/^diet 19% · fijo 30\.3k · \d candidatos$/)

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

test('/diet reset borra el historial y /diet status apaga la línea', async ($, on) => {
  const seen = world(on, { store: { [HISTORY_KEY]: { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } } } })
  await start($)
  expect((await diet($, '')).text).toMatch(/CANDIDATO\s+firecrawl/)

  expect((await diet($, 'reset')).text).toMatch(/historial borrado/)
  expect((await diet($, '')).text).toMatch(/OBSERVAR\s+firecrawl/)

  expect((await diet($, 'status off')).text).toMatch(/oculta/)
  expect(seen.statuses.at(-1)).toBe(undefined)
  expect((await diet($, 'status on')).text).toMatch(/activada/)
  expect(seen.statuses.at(-1)).toMatch(/^diet 19%/)
})

test('el historial viejo o corrupto no rompe el reporte', async ($, on) => {
  world(on, { store: { [HISTORY_KEY]: { sessions: { viejo: pastSession(90), roto: 'x' } } } })
  await start($)
  const report = JSON.parse((await diet($, '--json')).text ?? '') as DietReport
  expect(report.history.sessions).toBe(0)
  expect(NOW - 90 * DAY).toBeLessThan(NOW)
})

test('el panel dibuja el reporte en cada superficie y se actualiza', async ($, on) => {
  world(on, { store: { [HISTORY_KEY]: { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } } } })
  await start($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') {
      // Sin medición todavía: el botón la dispara.
      expect((await ui.find({ type: 'Text', text: /Sin medición/ }))?.text).toBe('Sin medición todavía.')
      await ui.press({ key: 'refresh' })
    }
    expect(await ui.find({ type: 'Text', text: /CANDIDATO\s+firecrawl · 8k · 0 llamadas/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /claude mcp remove -s user firecrawl/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fijo por request: 30\.3k/ })).toBeDefined()
    await ui.unmount()
  }

  expect((await diet($, 'panel')).text).toBe('Context Diet: panel abierto.')
})
