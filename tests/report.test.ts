import { expect, test } from 'claude-code/testing'

import { EMPTY_USAGE, buildReport, parseMcpTool, pruneHistory, restoreUsage, sanitizeHistory, serverLabel } from '../hooks/lib/report'
import { leaderCells, splitCells } from '../hooks/lib/label'
import { formatTokens, renderReport, summarize } from '../hooks/lib/render'
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
  expect(report.totals.mcpLoaded).toBe(9500)
  expect(report.totals.mcpDeferred).toBe(33000)
  expect(report.totals.mcpInstructions).toBe(1800)
  // Ordenados por lo que pesan ahora.
  expect(report.servers[0]?.name).toBe('firecrawl')
})

test('scope: config, conector de claude.ai, app, y configurado sin tools', () => {
  const { report } = build()
  expect(server(report, 'firecrawl').scope).toBe('user')
  expect(server(report, 'brave-search').scope).toBe('project')
  expect(server(report, 'claude_ai_Docs').scope).toBe('connector')
  expect(server(report, 'claude_ai_Docs').label).toBe('Docs (claude.ai)')
  expect(server(report, 'ccd_session').scope).toBe('host')
  const ableton = server(report, 'ableton')
  expect(ableton.isConnected).toBe(false)
  expect(ableton.tools).toBe(0)
})

test('nombres legibles: un id de conector no se muestra crudo', () => {
  const id = '1a59c906-04da-521d-bda7-7f71b9f9e01c'
  expect(serverLabel(id)).toBe('conector 1a59c906')
  // Sin otro nombre, sus tools lo identifican: ordenadas, tres como mucho.
  expect(serverLabel(id, id, ['update', 'guide', 'batch', 'read'])).toBe('conector 1a59c906 (batch, guide, read…)')
  expect(serverLabel(id, id, ['query'])).toBe('conector 1a59c906 (query)')
  // En el reporte, la etiqueta junta todas las tools del conector, cargadas o no.
  const usage = usageFixture()
  const breakdown = usage.context.breakdown!
  for (const [tool, isLoaded] of [['update', true], ['guide', false], ['batch', true], ['read', false]] as const) {
    breakdown.mcpTools.push({ name: `mcp__${id}__${tool}`, serverName: id, tokens: 100, isLoaded })
  }
  const connector = server(build({ usage }).report, id)
  expect(connector.label).toBe('conector 1a59c906 (batch, guide, read…)')
  expect(connector.scope).toBe('connector')
  expect(serverLabel(id, 'Claude Docs')).toBe('Claude Docs')
  expect(serverLabel('claude_ai_Claude_Docs')).toBe('Claude Docs (claude.ai)')
  expect(serverLabel('firecrawl', 'firecrawl')).toBe('firecrawl')
})

test('lo que aporta la app nunca es candidato, con el historial que sea', () => {
  const history = { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } }
  const { report } = build({ history })
  const host = server(report, 'ccd_session')
  expect(host.verdict).toBe('info')
  expect(host.action).toBe(null)
  expect(host.saving).toBe(0)
  const used = build({ history, counters: counters({ servers: { ccd_session: { calls: 2, errors: 0, lastAt: NOW } } }) })
  expect(server(used.report, 'ccd_session').verdict).toBe('used')
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

test('resumen: lo tuyo que pesa, lo ocioso en una línea y la app agregada', () => {
  const { report } = build({ usage: usageFixture({ messages: 20000 }) })
  const summary = summarize(report)
  expect(summary.shown.map(one => one.name)).toEqual(['firecrawl', 'claude_ai_Docs'])
  expect(summary.idle.map(one => one.name)).toEqual(['brave-search'])
  expect(summary.missing.map(one => one.name)).toEqual(['ableton'])
  expect(summary.host).toEqual({ servers: 1, loadedTokens: 1000, deferredTokens: 4000, calls: 0 })
  expect(summary.deferred).toEqual({ servers: 3, tokens: 33000 })
  expect(summary.composition[0]).toEqual({ label: 'Tools del sistema', tokens: 9700 })
  expect(summary.composition.some(part => /messages/i.test(part.label))).toBe(false)
  const { share } = summary
  expect(Math.round((share.fixed + share.conversation + share.free) * 100)).toBe(100)
  expect(summary.fixedPercent).toBe(Math.round((report.forecast.fixed / report.forecast.used) * 100))
})

test('aviso: solo con candidatos o con la compactación cerca', () => {
  expect(summarize(build().report).alert).toBe(null)
  const history = { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } }
  expect(summarize(build({ history }).report).alert).toBe('6 candidatos a apagar · −10.7k por request')
  const near = build({ usage: usageFixture({ messages: 120000 }), counters: counters({ turns: 3, samples: [100000, 110000, 120000] }) })
  expect(summarize(near.report).alert).toMatch(/^~\d turnos hasta la compactación$/)
})

test('la barra reparte todas sus celdas', () => {
  expect(splitCells([0.07, 0.19, 0.74], 50)).toEqual([4, 10, 36])
  expect(splitCells([0.001, 0, 0.999], 40)).toEqual([1, 0, 39])
  expect(splitCells([0.5, 0.5, 0], 9).reduce((sum, size) => sum + size, 0)).toBe(9)
})

test('una sesión reanudada recupera lo que su registro ya tenía', () => {
  const usage = usageFixture({ tokens: 38100 })
  const id = String(usage.startedAt)
  const before = build({ usage, counters: { ...EMPTY_USAGE, turns: 5, servers: { firecrawl: { calls: 4, errors: 0, lastAt: NOW } }, skillGroups: { 'plugin:agent-skills': { calls: 2, errors: 0, lastAt: NOW } } } })
  expect(before.history.sessions[id]?.servers.firecrawl?.calls).toBe(4)

  // La app reinicia: contadores en cero, y luego una llamada nueva a otro server.
  const after = build({ usage, history: before.history, counters: { ...EMPTY_USAGE, turns: 1, servers: { 'brave-search': { calls: 1, errors: 0, lastAt: NOW } } } })
  const record = after.history.sessions[id]
  expect([record?.turns, record?.servers.firecrawl?.calls, record?.servers['brave-search']?.calls]).toEqual([5, 4, 1])
  expect(record?.skillGroups['plugin:agent-skills']).toBe(2)
  expect(after.report.servers.find(server => server.name === 'firecrawl')?.verdict).toBe('used')
  // Aplicarlo otra vez no suma nada.
  expect(restoreUsage(after.counters, record)).toEqual(after.counters)
})

test('una fila con puntos guía mide el ancho exacto y recorta el nombre', () => {
  const cells = (name: string, value: string, width: number) => {
    const row = leaderCells(name, value, width)
    return `${row.name} ${row.dots} ${value}`
  }
  expect(cells('Skills', '10k', 20)).toBe('Skills ......... 10k')
  for (const name of ['a', 'Tools MCP cargadas', 'x'.repeat(80)]) expect(cells(name, '23.6k', 40).length).toBe(40)
  expect(leaderCells('x'.repeat(80), '23.6k', 40).name.endsWith('…')).toBe(true)
})

test('texto: resumen corto por defecto y todo con --all', () => {
  const history = { sessions: { a: pastSession(1), b: pastSession(2), c: pastSession(3) } }
  const { report } = build({ history, usage: usageFixture({ tokens: 38100 }) })
  const text = renderReport(report)
  expect(text).toMatch(/^Context Diet · \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC · claude-test\n/)
  expect(text).toContain('en uso      38.1k / 200k (19%)')
  expect(text).toContain('TUS SERVIDORES MCP (3)')
  expect(text).toMatch(/CANDIDATO\s+firecrawl \[user\] · 8k cargados \(2\/3 tools\) · 18k diferidos/)
  // brave-search es candidato (0 de ahorro): tiene veredicto, así que se muestra.
  expect(text).toMatch(/CANDIDATO\s+brave-search \[project\] · 0 cargados/)
  expect(text).toMatch(/SIN TOOLS\s+ableton/)
  expect(text).toContain('APP DE CLAUDE Y PLUGINS · 1 servers · 1k cargados')
  expect(text).not.toContain('ccd_session')
  expect(text).toContain('DIFERIDO · 3 servers · 33k tras ToolSearch · 0 por request')
  expect(text).toContain('claude mcp remove -s user firecrawl   # −8k')
  expect(text).toMatch(/PESADO \/home\/u\/\.claude\/CLAUDE\.md/)
  expect(text).toContain('Detalle: /diet --all.')

  const all = renderReport(report, { isDetailed: true })
  expect(all).toMatch(/· claude-test · detalle\n/)
  expect(all).toContain('| Veredicto | Server | Origen | Cargados | Tools | Diferidos | Llamadas | Historial |')
  expect(all).toContain('| `CANDIDATO` | firecrawl | user | 8k | 2/3 | 18k | 0 | usado en 0/3 sesiones |')
  expect(all).toMatch(/\| ccd_session \| 1k \|/)
  expect(all).toContain('| reviewer | plugin | 700 | 0 |')
  expect(all).toContain('| `/work/CLAUDE.md` | Project | 1.2k |  |')
  expect(all).toContain('| −8k | `claude mcp remove -s user firecrawl` |')
  expect(formatTokens(1_500_000)).toBe('1.5M')
  expect(formatTokens(null)).toBe('?')
})
