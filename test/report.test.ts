import { expect, test } from 'claude-code/testing'

import { buildReport, parseMcpTool, pruneHistory, sanitizeHistory } from '../hooks/lib/report'
import { formatTokens, renderReport, statusText } from '../hooks/lib/render'
import { DAY, NOW, counters, pastSession, usageFixture } from './fixtures'

const SCOPES = { firecrawl: 'user', 'brave-search': 'project', ableton: 'user' } as const

function build(options: Partial<Parameters<typeof buildReport>[0]> = {}) {
  return buildReport({
    usage: usageFixture(),
    counters: counters(),
    history: { sessions: {} },
    scopes: SCOPES,
    cwd: '/work',
    now: NOW,
    ...options,
  })
}

const server = (report: ReturnType<typeof build>['report'], name: string) => {
  const found = report.servers.find(one => one.name === name)
  if (!found) throw new Error(`no server ${name}`)
  return found
}
const group = (report: ReturnType<typeof build>['report'], key: string) => {
  const found = report.skillGroups.find(one => one.key === key)
  if (!found) throw new Error(`no group ${key}`)
  return found
}

test('parseMcpTool separa server y tool, y rechaza lo demás', () => {
  expect(parseMcpTool('mcp__brave-search__web_search')).toEqual({ server: 'brave-search', tool: 'web_search' })
  expect(parseMcpTool('mcp__a__b__c')).toEqual({ server: 'a', tool: 'b__c' })
  expect(parseMcpTool('Bash')).toBe(null)
  expect(parseMcpTool('mcp__solo')).toBe(null)
  expect(parseMcpTool(undefined)).toBe(null)
})

test('el costo por server separa lo cargado de lo diferido', () => {
  const { report } = build()
  const firecrawl = server(report, 'firecrawl')
  expect(firecrawl.tools).toBe(3)
  expect(firecrawl.loadedTools).toBe(2)
  expect(firecrawl.loadedTokens).toBe(8000)
  expect(firecrawl.deferredTokens).toBe(18000)
  // Un server 100% diferido no cuesta nada por request.
  expect(server(report, 'brave-search').loadedTokens).toBe(0)
  expect(report.totals.mcpLoaded).toBe(8500)
  expect(report.totals.mcpDeferred).toBe(29000)
  expect(report.totals.mcpInstructions).toBe(1800)
  // Ordenados por lo que pesan ahora.
  expect(report.servers[0]?.name).toBe('firecrawl')
})

test('scope: config, conector de claude.ai, y configurado sin tools', () => {
  const { report } = build()
  expect(server(report, 'firecrawl').scope).toBe('user')
  expect(server(report, 'brave-search').scope).toBe('project')
  expect(server(report, 'claude_ai_Docs').scope).toBe('connector')
  const ableton = server(report, 'ableton')
  expect(ableton.isConnected).toBe(false)
  expect(ableton.tools).toBe(0)
})

test('sin historial nada es candidato: una sesión no es evidencia', () => {
  const { report } = build({ counters: counters({ turns: 5 }) })
  expect(server(report, 'firecrawl').verdict).toBe('watch')
  expect(report.totals.candidates).toBe(0)
  expect(report.totals.potentialSaving).toBe(0)
})

test('candidato: sin uso en 3+ sesiones, con acción y ahorro', () => {
  const history = { sessions: { a: pastSession(1), b: pastSession(2) } }
  const { report } = build({ history, counters: counters({ turns: 2 }) })
  const firecrawl = server(report, 'firecrawl')
  expect(firecrawl.evidence.sessions).toBe(3)
  expect(firecrawl.verdict).toBe('candidate')
  expect(firecrawl.saving).toBe(8000)
  expect(firecrawl.action).toBe('claude mcp remove -s user firecrawl')
  expect(server(report, 'brave-search').action).toBe('claude mcp remove -s project brave-search')
  expect(server(report, 'brave-search').saving).toBe(0)
  expect(server(report, 'claude_ai_Docs').action).toMatch(/Conectores/)
  // Un server configurado pero sin tools nunca estuvo presente: no se juzga.
  expect(server(report, 'ableton').verdict).toBe('watch')
})

test('usado ahora gana; usado antes es ocasional, nunca candidato', () => {
  const history = {
    sessions: {
      a: pastSession(1, { servers: { 'brave-search': { calls: 4, loadedTokens: 0 } } }),
      b: pastSession(2),
      c: pastSession(3),
    },
  }
  const { report } = build({
    history,
    counters: counters({ turns: 1, servers: { firecrawl: { calls: 2, errors: 1, lastAt: NOW } } }),
  })
  expect(server(report, 'firecrawl').verdict).toBe('used')
  expect(server(report, 'firecrawl').errors).toBe(1)
  const brave = server(report, 'brave-search')
  expect(brave.verdict).toBe('occasional')
  expect(brave.evidence.usedSessions).toBe(1)
  expect(brave.evidence.calls).toBe(4)
  expect(brave.action).toBe(null)
})

test('skills: por plugin, una a una las propias, y las fijas sin acción', () => {
  const history = { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } }
  const { report } = build({
    history,
    counters: counters({ skills: { ctx: { calls: 1, errors: 0, lastAt: NOW } } }),
  })
  const plugin = group(report, 'plugin:agent-skills')
  expect(plugin.skills).toBe(2)
  expect(plugin.tokens).toBe(1500)
  expect(plugin.verdict).toBe('candidate')
  expect(plugin.action).toMatch(/^claude plugin disable agent-skills/)
  expect(group(report, 'skill:ctx').verdict).toBe('used')
  expect(group(report, 'skill:notes').verdict).toBe('candidate')
  expect(group(report, 'skill:notes').action).toMatch(/\.claude\/skills/)
  const builtIn = group(report, 'built-in')
  expect(builtIn.verdict).toBe('info')
  expect(builtIn.action).toBe(null)
  expect(report.totals.potentialSaving).toBe(8000 + 500 + 1500 + 300)
})

test('agentes con sus usos y memoria pesada marcada', () => {
  const { report } = build({ counters: counters({ agents: { reviewer: { calls: 3, errors: 0, lastAt: NOW } } }) })
  expect(report.agents).toEqual([{ agentType: 'reviewer', source: 'plugin', tokens: 700, calls: 3 }])
  expect(report.memory.map(file => [file.type, file.isHeavy])).toEqual([
    ['User', true],
    ['Project', false],
  ])
  expect(report.totals.memory).toBe(3700)
})

test('pronóstico: fijo vs conversación y turnos hasta compactar', () => {
  const usage = usageFixture({ messages: 20000, tokens: 50000 })
  const { report } = build({ usage, counters: counters({ turns: 4, samples: [30000, 35000, 20000, 25000, 30000] }) })
  const { forecast } = report
  expect(forecast.conversation).toBe(20000)
  expect(forecast.fixed).toBe(forecast.used - 20000)
  expect(report.totals.fixed).toBe(forecast.fixed)
  expect(forecast.threshold).toBe(167000)
  expect(forecast.headroom).toBe(167000 - forecast.used)
  // El salto negativo (una compactación) no entra en el ritmo.
  expect(forecast.perTurn).toBe(5000)
  expect(forecast.turnsLeft).toBe(Math.floor(forecast.headroom / 5000))
  expect(build().report.forecast.perTurn).toBe(null)
})

test('historial: la sesión entra solo con turnos, y lo viejo se poda', () => {
  expect(Object.keys(build().history.sessions)).toEqual([])
  const old = { sessions: { viejo: pastSession(45), reciente: pastSession(2) } }
  const { history, report } = build({ history: old, counters: counters({ turns: 1 }) })
  expect(Object.keys(history.sessions).sort()).toEqual([String(usageFixture().startedAt), 'reciente'].sort())
  expect(report.history.sessions).toBe(2)
  expect(report.history.days).toBe(2)
  expect(Object.keys(pruneHistory(old, NOW + 40 * DAY).sessions)).toEqual([])
})

test('sanitizeHistory tolera lo que haya en el store', () => {
  expect(sanitizeHistory(undefined)).toEqual({ sessions: {} })
  expect(sanitizeHistory('x')).toEqual({ sessions: {} })
  expect(sanitizeHistory({ sessions: { a: null, b: { startedAt: 1 }, c: { startedAt: 1, lastAt: 2 } } })).toEqual({
    sessions: { c: { startedAt: 1, lastAt: 2, turns: 0, servers: {}, skillGroups: {}, skills: {} } },
  })
})

test('render: el texto trae cada sección, veredicto y acción', () => {
  const history = { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } }
  const { report } = build({ history, usage: usageFixture({ tokens: 38100 }) })
  const text = renderReport(report)
  for (const heading of ['CONTEXTO', 'MCP (3)', 'SKILLS', 'AGENTES', 'MEMORIA', 'ACCIONES']) {
    expect(text).toContain(heading)
  }
  expect(text).toContain('38.1k / 200k (19%)')
  expect(text).toMatch(/CANDIDATO\s+firecrawl \[user\] · 8k cargados \(2\/3 tools\) · 18k diferidos/)
  expect(text).toMatch(/SIN TOOLS\s+ableton/)
  expect(text).toContain('claude mcp remove -s user firecrawl   # −8k')
  expect(text).toMatch(/PESADO\s+\/home\/u\/\.claude\/CLAUDE\.md/)
  expect(statusText(report)).toBe('diet 19% · fijo 30.3k · 6 candidatos')
  expect(statusText(null)).toBe(undefined)
  expect(formatTokens(1_500_000)).toBe('1.5M')
  expect(formatTokens(null)).toBe('?')
})
