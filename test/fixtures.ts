// Datos de prueba con la forma real de `$.session.usage({ breakdown })`,
// tomada de una sesión de Claude Code 2.1.325.
import type { ContextCategoryKind, SessionUsage } from 'claude-code'

import type { DietSessionRecord, DietUsage } from '../types'

export const DAY = 24 * 60 * 60 * 1000
export const NOW = 1_800_000_000_000
export const STARTED = NOW - 60_000

type Tool = { server: string; tool: string; tokens: number; isLoaded: boolean }

const TOOLS: Tool[] = [
  { server: 'firecrawl', tool: 'scrape', tokens: 5000, isLoaded: true },
  { server: 'firecrawl', tool: 'search', tokens: 3000, isLoaded: true },
  { server: 'firecrawl', tool: 'crawl', tokens: 18000, isLoaded: false },
  { server: 'brave-search', tool: 'web', tokens: 11000, isLoaded: false },
  { server: 'claude_ai_Docs', tool: 'read', tokens: 500, isLoaded: true },
]

export function usageFixture(options: { messages?: number; tokens?: number } = {}): SessionUsage {
  const messages = options.messages ?? 0
  const fixed = 2900 + 9700 + 8500 + 1800 + 700 + 3000 + 1200
  type Row = { name: string; tokens: number; kind: ContextCategoryKind }
  const conversation: Row[] = messages ? [{ name: 'Messages', tokens: messages, kind: 'used' }] : []
  const categories: Row[] = [
    { name: 'System prompt', tokens: 2900, kind: 'used' },
    { name: 'System tools', tokens: 9700, kind: 'used' },
    { name: 'MCP tools', tokens: 8500, kind: 'used' },
    { name: 'MCP server instructions', tokens: 1800, kind: 'used' },
    { name: 'MCP tools (deferred)', tokens: 29000, kind: 'deferred' },
    { name: 'Custom agents', tokens: 700, kind: 'used' },
    { name: 'Skills', tokens: 3000, kind: 'used' },
    { name: 'Memory files', tokens: 1200 + 2500, kind: 'used' },
    ...conversation,
    { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
    { name: 'Free space', tokens: 100000, kind: 'free' },
  ]
  return {
    startedAt: STARTED,
    rateLimits: [],
    context: {
      window: 200000,
      ...(options.tokens === undefined ? {} : { tokens: options.tokens, percent: Math.round(options.tokens / 2000) }),
      breakdown: {
        categories: categories.map(row => ({ ...row, color: 'inactive', isDeferred: row.kind === 'deferred' })),
        totalTokens: fixed + 2500 + messages,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        autocompactSource: 'auto',
        percentage: 15,
        gridRows: [],
        model: 'claude-test',
        memoryFiles: [
          { path: '/work/CLAUDE.md', type: 'Project', tokens: 1200 },
          { path: '/home/u/.claude/CLAUDE.md', type: 'User', tokens: 2500 },
        ],
        mcpTools: TOOLS.map(tool => ({
          name: `mcp__${tool.server}__${tool.tool}`,
          serverName: tool.server,
          tokens: tool.tokens,
          isLoaded: tool.isLoaded,
        })),
        agents: [{ agentType: 'reviewer', source: 'plugin', tokens: 700 }],
        skills: {
          totalSkills: 5,
          includedSkills: 5,
          tokens: 3000,
          skillFrontmatter: [
            { name: 'tdd', source: 'plugin', pluginName: 'agent-skills', tokens: 900 },
            { name: 'review', source: 'plugin', pluginName: 'agent-skills', tokens: 600 },
            { name: 'ctx', source: 'userSettings', tokens: 400 },
            { name: 'loop', source: 'built-in', tokens: 800 },
            { name: 'notes', source: 'projectSettings', tokens: 300 },
          ],
        },
        autoCompactThreshold: 167000,
        isAutoCompactEnabled: true,
        apiUsage: null,
      },
    },
  }
}

export function counters(partial: Partial<DietUsage> = {}): DietUsage {
  return { servers: {}, skills: {}, skillGroups: {}, agents: {}, turns: 0, samples: [], ...partial }
}

/** Una sesión pasada en la que todo estuvo presente y nada se usó, salvo lo dado. */
export function pastSession(daysAgo: number, used: Partial<DietSessionRecord> = {}): DietSessionRecord {
  return {
    startedAt: NOW - daysAgo * DAY,
    lastAt: NOW - daysAgo * DAY + 1000,
    turns: 4,
    servers: {
      firecrawl: { calls: 0, loadedTokens: 8000 },
      'brave-search': { calls: 0, loadedTokens: 0 },
      claude_ai_Docs: { calls: 0, loadedTokens: 500 },
      ...used.servers,
    },
    skillGroups: { 'plugin:agent-skills': 0, 'built-in': 0, ...used.skillGroups },
    skills: { ctx: 0, notes: 0, ...used.skills },
  }
}
