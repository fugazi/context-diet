// Lógica pura del reporte: sin `$`, sin I/O. Todo lo que entra son datos.
import type { SessionUsage } from 'claude-code'

import type {
  DietAgent,
  DietCategory,
  DietEvidence,
  DietForecast,
  DietHistory,
  DietMemoryFile,
  DietReport,
  DietScope,
  DietServer,
  DietSessionRecord,
  DietSkillGroup,
  DietUsage,
  DietVerdict,
} from '../../types'

/** Sesiones con al menos un turno necesarias para llamar algo `candidate`. */
export const MIN_SESSIONS = 3
export const HISTORY_DAYS = 30
export const HISTORY_MAX_SESSIONS = 200
/** Un archivo de memoria por encima de esto se marca como pesado. */
export const HEAVY_MEMORY_TOKENS = 2000
const DAY_MS = 24 * 60 * 60 * 1000
/** Fuentes de skills que el usuario no puede quitar por su cuenta. */
const FIXED_SKILL_SOURCES = new Set(['built-in', 'syncedSkills', 'policySettings', 'mcp'])
const FIXED_SKILL_LABELS: Record<string, string> = {
  'built-in': 'integradas',
  syncedSkills: 'sincronizadas',
  policySettings: 'de la organización',
  mcp: 'de servers MCP',
}
const OWN_SKILL_SOURCES = new Set(['userSettings', 'projectSettings'])

export const EMPTY_USAGE: DietUsage = {
  servers: {},
  skills: {},
  skillGroups: {},
  agents: {},
  turns: 0,
  samples: [],
}

export const EMPTY_HISTORY: DietHistory = { sessions: {} }

export type ReportInput = {
  usage: SessionUsage
  counters: DietUsage
  history: DietHistory
  /** Scope de cada server configurado, por nombre. */
  scopes: Record<string, DietScope>
  cwd: string
  now: number
}

export function skillGroupKey(source: string, pluginName?: string | null): string {
  return pluginName ? `plugin:${pluginName}` : source
}

/** `mcp__server__tool` → sus dos partes; null si no es una tool MCP. */
export function parseMcpTool(name: unknown): { server: string; tool: string } | null {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const index = rest.indexOf('__')
  if (index <= 0 || index >= rest.length - 2) return null
  return { server: rest.slice(0, index), tool: rest.slice(index + 2) }
}

/** Deja solo sesiones recientes, y como mucho las últimas N. */
export function pruneHistory(history: DietHistory, now: number): DietHistory {
  const cutoff = now - HISTORY_DAYS * DAY_MS
  const kept = Object.entries(history.sessions)
    .filter(([, record]) => record.lastAt >= cutoff)
    .sort(([, a], [, b]) => b.lastAt - a.lastAt)
    .slice(0, HISTORY_MAX_SESSIONS)
  return { sessions: Object.fromEntries(kept) }
}

/** Acepta lo que haya en `$.store` y devuelve un historial bien formado. */
export function sanitizeHistory(value: unknown): DietHistory {
  if (!value || typeof value !== 'object') return EMPTY_HISTORY
  const raw = (value as { sessions?: unknown }).sessions
  if (!raw || typeof raw !== 'object') return EMPTY_HISTORY
  const sessions: Record<string, DietSessionRecord> = {}
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Partial<DietSessionRecord>
    if (typeof record.startedAt !== 'number' || typeof record.lastAt !== 'number') continue
    sessions[id] = {
      startedAt: record.startedAt,
      lastAt: record.lastAt,
      turns: typeof record.turns === 'number' ? record.turns : 0,
      servers: record.servers && typeof record.servers === 'object' ? record.servers : {},
      skillGroups: record.skillGroups && typeof record.skillGroups === 'object' ? record.skillGroups : {},
      skills: record.skills && typeof record.skills === 'object' ? record.skills : {},
    }
  }
  return { sessions }
}

function evidenceOf(
  history: DietHistory,
  pick: (record: DietSessionRecord) => number | undefined,
): DietEvidence {
  const evidence: DietEvidence = { sessions: 0, usedSessions: 0, calls: 0, lastUsedAt: null }
  for (const record of Object.values(history.sessions)) {
    if (record.turns < 1) continue
    const calls = pick(record)
    if (calls === undefined) continue
    evidence.sessions += 1
    if (calls > 0) {
      evidence.usedSessions += 1
      evidence.calls += calls
      if (evidence.lastUsedAt === null || record.lastAt > evidence.lastUsedAt) {
        evidence.lastUsedAt = record.lastAt
      }
    }
  }
  return evidence
}

function verdictOf(callsNow: number, evidence: DietEvidence): DietVerdict {
  if (callsNow > 0) return 'used'
  if (evidence.usedSessions > 0) return 'occasional'
  if (evidence.sessions >= MIN_SESSIONS) return 'candidate'
  return 'watch'
}

function scopeOf(name: string, scopes: Record<string, DietScope>): DietScope {
  const known = scopes[name]
  if (known) return known
  if (/^claude[._ ]ai[_ ]/i.test(name)) return 'connector'
  return 'unknown'
}

function serverAction(name: string, scope: DietScope): string {
  if (scope === 'connector') return `desconecta "${name}" desde /mcp o en claude.ai → Conectores`
  if (scope === 'unknown') return `"${name}" lo aporta un plugin u otra fuente: revisa \`claude plugin list\``
  return `claude mcp remove -s ${scope} ${name}`
}

function buildServers(input: ReportInput, history: DietHistory): DietServer[] {
  const breakdown = input.usage.context.breakdown
  const byName = new Map<string, DietServer>()
  const blank = (name: string): DietServer => ({
    name,
    scope: scopeOf(name, input.scopes),
    tools: 0,
    loadedTools: 0,
    totalTokens: 0,
    loadedTokens: 0,
    deferredTokens: 0,
    isConnected: false,
    calls: 0,
    errors: 0,
    evidence: { sessions: 0, usedSessions: 0, calls: 0, lastUsedAt: null },
    verdict: 'watch',
    saving: 0,
    action: null,
  })
  // Un server configurado puede no traer tools (desconectado): se lista igual.
  for (const name of Object.keys(input.scopes)) byName.set(name, blank(name))
  for (const tool of breakdown?.mcpTools ?? []) {
    // El nombre de la tool lleva la grafía con la que llegan los `tool.call`.
    const name = parseMcpTool(tool.name)?.server ?? tool.serverName
    const server = byName.get(name) ?? byName.get(tool.serverName) ?? blank(name)
    byName.set(server.name, server)
    server.isConnected = true
    server.tools += 1
    server.totalTokens += tool.tokens
    if (tool.isLoaded) {
      server.loadedTools += 1
      server.loadedTokens += tool.tokens
    } else {
      server.deferredTokens += tool.tokens
    }
  }
  for (const server of byName.values()) {
    // Un nombre de config con espacios llega normalizado en los `tool.call`.
    const counter =
      input.counters.servers[server.name] ?? input.counters.servers[server.name.replace(/[^a-zA-Z0-9_-]/g, '_')]
    server.calls = counter?.calls ?? 0
    server.errors = counter?.errors ?? 0
    server.evidence = evidenceOf(history, record => record.servers[server.name]?.calls)
    server.verdict = verdictOf(server.calls, server.evidence)
    if (server.verdict === 'candidate') {
      server.saving = server.loadedTokens
      server.action = serverAction(server.name, server.scope)
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.loadedTokens - a.loadedTokens || b.totalTokens - a.totalTokens || a.name.localeCompare(b.name),
  )
}

function buildSkillGroups(input: ReportInput, history: DietHistory): DietSkillGroup[] {
  const listed = input.usage.context.breakdown?.skills?.skillFrontmatter ?? []
  const byKey = new Map<string, DietSkillGroup>()
  for (const skill of listed) {
    const source = String(skill.source)
    const isOwn = OWN_SKILL_SOURCES.has(source) && !skill.pluginName
    // Las skills propias se juzgan una a una; las de un plugin, por plugin.
    const key = isOwn ? `skill:${skill.name}` : skillGroupKey(source, skill.pluginName)
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        label: isOwn ? skill.name : (skill.pluginName ?? FIXED_SKILL_LABELS[source] ?? source),
        source,
        pluginName: skill.pluginName ?? null,
        skills: 0,
        tokens: 0,
        loads: 0,
        evidence: { sessions: 0, usedSessions: 0, calls: 0, lastUsedAt: null },
        verdict: 'watch',
        saving: 0,
        action: null,
      }
      byKey.set(key, group)
    }
    group.skills += 1
    group.tokens += skill.tokens
  }
  for (const group of byKey.values()) {
    const isOwn = group.key.startsWith('skill:')
    const counter = isOwn ? input.counters.skills[group.label] : input.counters.skillGroups[group.key]
    group.loads = counter?.calls ?? 0
    group.evidence = isOwn
      ? evidenceOf(history, record => record.skills[group.label])
      : evidenceOf(history, record => record.skillGroups[group.key])
    if (FIXED_SKILL_SOURCES.has(group.source) && !group.pluginName) {
      group.verdict = group.loads > 0 ? 'used' : 'info'
      continue
    }
    group.verdict = verdictOf(group.loads, group.evidence)
    if (group.verdict !== 'candidate') continue
    group.saving = group.tokens
    group.action = group.pluginName
      ? `claude plugin disable ${group.pluginName}   # antes: claude plugin details ${group.pluginName}`
      : `mueve la carpeta de la skill "${group.label}" fuera de ${group.source === 'projectSettings' ? '.claude/skills' : '~/.claude/skills'}`
  }
  return [...byKey.values()].sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label))
}

function buildForecast(input: ReportInput, categories: DietCategory[]): DietForecast {
  const breakdown = input.usage.context.breakdown
  const used = breakdown?.totalTokens ?? input.usage.context.tokens ?? 0
  const isAutoCompactEnabled = breakdown?.isAutoCompactEnabled ?? false
  const window = breakdown?.rawMaxTokens ?? input.usage.context.window
  const threshold = isAutoCompactEnabled && breakdown?.autoCompactThreshold ? breakdown.autoCompactThreshold : window
  // La API pide no ramificar por `name`, pero es lo único que separa la
  // conversación del resto; si la fila cambia de nombre, todo cuenta como fijo.
  const conversation = categories
    .filter(row => row.kind === 'used' && /^messages$/i.test(row.name))
    .reduce((sum, row) => sum + row.tokens, 0)
  const fixed = categories.filter(row => row.kind === 'used').reduce((sum, row) => sum + row.tokens, 0) - conversation
  const headroom = Math.max(0, threshold - used)

  const samples = input.counters.samples.slice(-11)
  const deltas: number[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const delta = (samples[index] ?? 0) - (samples[index - 1] ?? 0)
    // Un delta negativo es una compactación: no dice nada del ritmo.
    if (delta > 0) deltas.push(delta)
  }
  const perTurn = deltas.length ? Math.round(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length) : null
  const turnsLeft = perTurn ? Math.floor(headroom / perTurn) : null
  return { used, threshold, isAutoCompactEnabled, headroom, fixed, conversation, perTurn, turnsLeft }
}

/** El registro de esta sesión para el historial, con todo lo presente. */
function currentRecord(
  input: ReportInput,
  servers: DietServer[],
  groups: DietSkillGroup[],
): DietSessionRecord {
  const record: DietSessionRecord = {
    startedAt: input.usage.startedAt,
    lastAt: input.now,
    turns: input.counters.turns,
    servers: {},
    skillGroups: {},
    skills: {},
  }
  for (const server of servers) {
    if (server.isConnected) record.servers[server.name] = { calls: server.calls, loadedTokens: server.loadedTokens }
  }
  for (const group of groups) {
    if (group.key.startsWith('skill:')) record.skills[group.label] = group.loads
    else record.skillGroups[group.key] = group.loads
  }
  return record
}

/**
 * Construye el reporte y el historial ya actualizado con esta sesión.
 * La sesión en curso solo cuenta como evidencia si completó algún turno.
 */
export function buildReport(input: ReportInput): { report: DietReport; history: DietHistory } {
  const breakdown = input.usage.context.breakdown
  const id = String(input.usage.startedAt)
  const pruned = pruneHistory(input.history, input.now)

  // Primera pasada sin evidencia, solo para saber qué hay presente ahora.
  const present = currentRecord(input, buildServers(input, EMPTY_HISTORY), buildSkillGroups(input, EMPTY_HISTORY))
  const history: DietHistory =
    present.turns > 0 ? { sessions: { ...pruned.sessions, [id]: present } } : pruned

  const servers = buildServers(input, history)
  const skillGroups = buildSkillGroups(input, history)
  const categories: DietCategory[] = (breakdown?.categories ?? []).map(row => ({
    name: row.name,
    tokens: row.tokens,
    kind: row.kind,
  }))
  const agents: DietAgent[] = (breakdown?.agents ?? [])
    .map(agent => ({
      agentType: agent.agentType,
      source: agent.source,
      tokens: agent.tokens,
      calls: input.counters.agents[agent.agentType]?.calls ?? 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)
  const memory: DietMemoryFile[] = (breakdown?.memoryFiles ?? [])
    .map(file => ({
      path: file.path,
      type: file.type,
      tokens: file.tokens,
      isHeavy: file.tokens >= HEAVY_MEMORY_TOKENS,
    }))
    .sort((a, b) => b.tokens - a.tokens)
  const forecast = buildForecast(input, categories)
  const candidates = [...servers, ...skillGroups].filter(item => item.verdict === 'candidate')
  const stamps = Object.values(history.sessions).map(record => record.startedAt)
  const instructions = categories
    .filter(row => /mcp server instructions/i.test(row.name))
    .reduce((sum, row) => sum + row.tokens, 0)

  const report: DietReport = {
    generatedAt: input.now,
    cwd: input.cwd,
    model: breakdown?.model ?? '',
    window: input.usage.context.window,
    tokens: input.usage.context.tokens ?? null,
    percent: input.usage.context.percent ?? null,
    categories,
    totals: {
      fixed: forecast.fixed,
      mcpLoaded: servers.reduce((sum, server) => sum + server.loadedTokens, 0),
      mcpDeferred: servers.reduce((sum, server) => sum + server.deferredTokens, 0),
      mcpInstructions: instructions,
      skills: breakdown?.skills?.tokens ?? skillGroups.reduce((sum, group) => sum + group.tokens, 0),
      agents: agents.reduce((sum, agent) => sum + agent.tokens, 0),
      memory: memory.reduce((sum, file) => sum + file.tokens, 0),
      potentialSaving: candidates.reduce((sum, item) => sum + item.saving, 0),
      candidates: candidates.length,
    },
    servers,
    skillGroups,
    agents,
    memory,
    forecast,
    history: {
      sessions: Object.values(history.sessions).filter(record => record.turns > 0).length,
      days: stamps.length ? Math.max(1, Math.ceil((input.now - Math.min(...stamps)) / DAY_MS)) : 0,
      minSessions: MIN_SESSIONS,
    },
    turns: input.counters.turns,
  }
  return { report, history }
}
