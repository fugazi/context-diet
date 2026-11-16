// Lógica pura del reporte: sin `$`, sin I/O. Todo lo que entra son datos.
import type { SessionUsage } from 'claude-code'

import type {
  DietAgent,
  DietCategory,
  DietCounter,
  DietEvidence,
  DietForecast,
  DietHistory,
  DietLang,
  DietMemoryFile,
  DietReport,
  DietScope,
  DietServer,
  DietSessionRecord,
  DietSkillGroup,
  DietTrend,
  DietUsage,
  DietVerdict,
} from '../../types'
import { strings } from './i18n'

/**
 * Para llamar algo `candidate` hace falta no haberlo usado en sesiones de
 * `MIN_DAYS` días distintos, y solo cuentan las de `MIN_TURNS` turnos o más:
 * tres sesiones cortas en una mañana no dicen si algo se usa.
 */
export const MIN_DAYS = 3
export const MIN_TURNS = 3
export const HISTORY_DAYS = 30
export const HISTORY_MAX_SESSIONS = 200
/** Un archivo de memoria por encima de esto se marca como pesado. */
export const HEAVY_MEMORY_TOKENS = 2000
const DAY_MS = 24 * 60 * 60 * 1000
/** Fuentes de skills que el usuario no puede quitar por su cuenta. */
const FIXED_SKILL_SOURCES = new Set(['built-in', 'syncedSkills', 'policySettings', 'mcp'])
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
  /** El idioma de etiquetas y acciones; inglés si falta. */
  lang?: DietLang
}

/** La grafía con la que llegan los `tool.call` de un server: su clave en los contadores. */
export function serverKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
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
      ...(typeof record.fixed === 'number' && Number.isFinite(record.fixed) ? { fixed: record.fixed } : {}),
    }
  }
  return { sessions }
}

/**
 * Los contadores de la sesión, con lo que su registro guardado ya sabía. Los
 * contadores viven en `$.state`, que se vacía si la app reinicia o la sesión
 * se reanuda; sin esto el registro guardado se pisaba con ceros. Es un máximo
 * por clave, así que aplicarlo de más no cambia nada.
 */
export function restoreUsage(counters: DietUsage, record: DietSessionRecord | undefined): DietUsage {
  if (!record) return counters
  const lift = (table: Record<string, DietCounter>, stored: Record<string, number>) => {
    const next = { ...table }
    for (const [key, calls] of Object.entries(stored)) {
      const now = next[key]
      if (typeof calls !== 'number' || calls <= (now?.calls ?? 0)) continue
      next[key] = { calls, errors: now?.errors ?? 0, lastAt: now?.lastAt ?? record.lastAt }
    }
    return next
  }
  // El registro guarda el nombre del config; los contadores, el de los `tool.call`.
  const serverCalls = Object.fromEntries(
    Object.entries(record.servers).map(([name, one]) => [serverKey(name), one?.calls ?? 0]),
  )
  return {
    ...counters,
    turns: Math.max(counters.turns, record.turns),
    servers: lift(counters.servers, serverCalls),
    skillGroups: lift(counters.skillGroups, record.skillGroups),
    skills: lift(counters.skills, record.skills),
  }
}

/** El día de calendario, en la hora local, en que empezó una sesión. */
function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function evidenceOf(
  history: DietHistory,
  pick: (record: DietSessionRecord) => number | undefined,
): DietEvidence {
  const evidence: DietEvidence = { sessions: 0, days: 0, usedSessions: 0, calls: 0, lastUsedAt: null }
  const days = new Set<string>()
  for (const record of Object.values(history.sessions)) {
    if (record.turns < 1) continue
    const calls = pick(record)
    if (calls === undefined) continue
    // Un uso cuenta venga de donde venga; no haberlo usado solo dice algo en
    // una sesión con trabajo de verdad.
    if (calls <= 0 && record.turns < MIN_TURNS) continue
    evidence.sessions += 1
    days.add(dayKey(record.startedAt))
    if (calls > 0) {
      evidence.usedSessions += 1
      evidence.calls += calls
      if (evidence.lastUsedAt === null || record.lastAt > evidence.lastUsedAt) {
        evidence.lastUsedAt = record.lastAt
      }
    }
  }
  evidence.days = days.size
  return evidence
}

function verdictOf(callsNow: number, evidence: DietEvidence): DietVerdict {
  if (callsNow > 0) return 'used'
  if (evidence.usedSessions > 0) return 'occasional'
  if (evidence.days >= MIN_DAYS) return 'candidate'
  return 'watch'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLAUDE_AI = /^claude[._ ]ai[_ ]/i

function scopeOf(name: string, scopes: Record<string, DietScope>): DietScope {
  const known = scopes[name]
  if (known) return known
  // Los conectores de claude.ai llegan con ese prefijo o, en la app, con un id.
  if (CLAUDE_AI.test(name) || UUID.test(name)) return 'connector'
  return 'host'
}

const HINT_TOOLS = 3

/**
 * Un nombre que se pueda leer: el que lista /mcp cuando dice más que la clave.
 * Un conector que solo llega con su id (así lo da la app de escritorio, y el
 * motor no expone otro nombre) se reconoce por sus tools.
 */
export function serverLabel(
  name: string,
  serverName?: string,
  tools: readonly string[] = [],
  lang?: DietLang,
): string {
  const shown = serverName && !UUID.test(serverName) ? serverName : name
  if (UUID.test(shown)) {
    const base = `${strings(lang).connector} ${shown.slice(0, 8)}`
    if (tools.length === 0) return base
    const hint = [...tools].sort().slice(0, HINT_TOOLS).join(', ')
    return `${base} (${hint}${tools.length > HINT_TOOLS ? '…' : ''})`
  }
  if (CLAUDE_AI.test(shown)) return `${shown.replace(CLAUDE_AI, '').replace(/_/g, ' ')} (claude.ai)`
  return shown
}

function serverAction(server: DietServer, lang?: DietLang): string {
  if (server.scope === 'connector') return strings(lang).actionConnector(server.label)
  return `claude mcp remove -s ${server.scope} ${server.name}`
}

function buildServers(input: ReportInput, history: DietHistory): DietServer[] {
  const breakdown = input.usage.context.breakdown
  const byName = new Map<string, DietServer>()
  const blank = (name: string): DietServer => ({
    name,
    label: serverLabel(name, undefined, [], input.lang),
    scope: scopeOf(name, input.scopes),
    tools: 0,
    loadedTools: 0,
    totalTokens: 0,
    loadedTokens: 0,
    deferredTokens: 0,
    isConnected: false,
    calls: 0,
    errors: 0,
    evidence: { sessions: 0, days: 0, usedSessions: 0, calls: 0, lastUsedAt: null },
    verdict: 'watch',
    saving: 0,
    action: null,
  })
  // Un server configurado puede no traer tools (desconectado): se lista igual.
  for (const name of Object.keys(input.scopes)) byName.set(name, blank(name))
  const toolNames = new Map<string, string[]>()
  for (const tool of breakdown?.mcpTools ?? []) {
    // El nombre de la tool lleva la grafía con la que llegan los `tool.call`.
    const parsed = parseMcpTool(tool.name)
    const name = parsed?.server ?? tool.serverName
    const server = byName.get(name) ?? byName.get(tool.serverName) ?? blank(name)
    byName.set(server.name, server)
    const names = toolNames.get(server.name) ?? []
    if (parsed) names.push(parsed.tool)
    toolNames.set(server.name, names)
    server.isConnected = true
    server.label = serverLabel(server.name, tool.serverName, names, input.lang)
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
    const counter = input.counters.servers[serverKey(server.name)] ?? input.counters.servers[server.name]
    server.calls = counter?.calls ?? 0
    server.errors = counter?.errors ?? 0
    server.evidence = evidenceOf(history, record => record.servers[server.name]?.calls)
    // Lo que aporta la app o un plugin no se quita desde un config: no se juzga.
    server.verdict =
      server.scope === 'host' ? (server.calls > 0 ? 'used' : 'info') : verdictOf(server.calls, server.evidence)
    if (server.verdict === 'candidate') {
      server.saving = server.loadedTokens
      server.action = serverAction(server, input.lang)
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.loadedTokens - a.loadedTokens || b.totalTokens - a.totalTokens || a.name.localeCompare(b.name),
  )
}

function buildSkillGroups(input: ReportInput, history: DietHistory): DietSkillGroup[] {
  const t = strings(input.lang)
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
        label: isOwn ? skill.name : (skill.pluginName ?? t.fixedSkills[source] ?? source),
        source,
        pluginName: skill.pluginName ?? null,
        skills: 0,
        tokens: 0,
        loads: 0,
        evidence: { sessions: 0, days: 0, usedSessions: 0, calls: 0, lastUsedAt: null },
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
      ? t.actionPlugin(group.pluginName)
      : t.actionSkill(group.label, group.source === 'projectSettings' ? '.claude/skills' : '~/.claude/skills')
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

/**
 * La dieta en una cifra: el fijo de ahora contra el de la sesión más antigua
 * del historial que lo guardó. La sesión en curso no se compara consigo misma.
 */
export function buildTrend(history: DietHistory, currentId: string, fixed: number, now: number): DietTrend | null {
  const earlier = Object.entries(history.sessions)
    .filter(([id, record]) => id !== currentId && typeof record.fixed === 'number' && record.fixed > 0)
    .map(([, record]) => record)
    .sort((a, b) => a.startedAt - b.startedAt)[0]
  if (!earlier || earlier.fixed === undefined) return null
  const startOfDay = (at: number) => {
    const date = new Date(at)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }
  const delta = fixed - earlier.fixed
  return {
    baseline: earlier.fixed,
    baselineAt: earlier.startedAt,
    days: Math.max(0, Math.round((startOfDay(now) - startOfDay(earlier.startedAt)) / DAY_MS)),
    delta,
    percent: Math.round((delta / earlier.fixed) * 100),
  }
}

/** El registro de esta sesión para el historial, con todo lo presente. */
function currentRecord(
  input: ReportInput,
  servers: DietServer[],
  groups: DietSkillGroup[],
  fixed: number,
): DietSessionRecord {
  const record: DietSessionRecord = {
    startedAt: input.usage.startedAt,
    lastAt: input.now,
    turns: input.counters.turns,
    fixed,
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
export function buildReport(input: ReportInput): { report: DietReport; history: DietHistory; counters: DietUsage } {
  const breakdown = input.usage.context.breakdown
  const id = String(input.usage.startedAt)
  const pruned = pruneHistory(input.history, input.now)
  // Lo que el registro de esta sesión ya tenía no se pierde con un reinicio.
  input = { ...input, counters: restoreUsage(input.counters, pruned.sessions[id]) }

  // Primera pasada sin evidencia, solo para saber qué hay presente ahora.
  const categories: DietCategory[] = (breakdown?.categories ?? []).map(row => ({
    name: row.name,
    tokens: row.tokens,
    kind: row.kind,
  }))
  const forecast = buildForecast(input, categories)
  const present = currentRecord(
    input,
    buildServers(input, EMPTY_HISTORY),
    buildSkillGroups(input, EMPTY_HISTORY),
    forecast.fixed,
  )
  const history: DietHistory =
    present.turns > 0 ? { sessions: { ...pruned.sessions, [id]: present } } : pruned

  const servers = buildServers(input, history)
  const skillGroups = buildSkillGroups(input, history)
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
  const candidates = [...servers, ...skillGroups].filter(item => item.verdict === 'candidate')
  const counted = Object.values(history.sessions).filter(record => record.turns > 0)
  const stamps = counted.map(record => record.startedAt)
  const instructions = categories
    .filter(row => /mcp server instructions/i.test(row.name))
    .reduce((sum, row) => sum + row.tokens, 0)

  const report: DietReport = {
    lang: input.lang ?? 'en',
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
    trend: buildTrend(history, id, forecast.fixed, input.now),
    history: {
      sessions: counted.length,
      days: stamps.length ? Math.max(1, Math.ceil((input.now - Math.min(...stamps)) / DAY_MS)) : 0,
      evidenceDays: new Set(counted.filter(record => record.turns >= MIN_TURNS).map(record => dayKey(record.startedAt))).size,
      minDays: MIN_DAYS,
      minTurns: MIN_TURNS,
    },
    turns: input.counters.turns,
  }
  return { report, history, counters: input.counters }
}
