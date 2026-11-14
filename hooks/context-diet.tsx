// Context Diet
// Audita el costo de contexto de MCPs, skills, agentes y memoria de la sesión.
// Registra un comando, no una tool: medir tokens no debe agregar tokens.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DietCounter, DietHistory, DietReport, DietScope, DietUsage } from '../types'
import { EMPTY_HISTORY, EMPTY_USAGE, buildReport, parseMcpTool, sanitizeHistory, skillGroupKey } from './lib/report'
import { VERDICT_LABEL, evidenceText, forecastText, formatTokens, renderReport, statusText } from './lib/render'

const PANE = 'context-diet'
const PANE_TITLE = 'Context Diet'
const HISTORY_KEY = 'history-1'
const STATUS_KEY = 'status-line'
const HELP = [
  '/diet                 reporte en el transcript',
  '/diet --json          el mismo reporte como JSON',
  '/diet panel           abre el panel en vivo',
  '/diet status on|off   muestra u oculta la línea de estado',
  '/diet reset           borra el historial entre sesiones',
].join('\n')

// Cambia la etiqueta cuando cambie la forma: descarta lo que guardó una
// versión anterior, que sobrevive a un hot reload.
const usageAtom = atom({ plugin: 'context-diet', key: 'usage' } as const, EMPTY_USAGE, { shape: 'usage-1' })
const reportAtom = atom({ plugin: 'context-diet', key: 'report' } as const, null, { shape: 'report-1' })

type Engine = EngineInterface

// Los configs de MCP no cambian dentro de una sesión: se leen una vez.
let scopesCache: { cwd: string; scopes: Record<string, DietScope> } | null = null

function bump(table: Record<string, DietCounter>, key: string, now: number, isError: boolean) {
  const previous = table[key] ?? { calls: 0, errors: 0, lastAt: 0 }
  return {
    ...table,
    [key]: { calls: previous.calls + 1, errors: previous.errors + (isError ? 1 : 0), lastAt: now },
  }
}

async function readJson($: Engine, path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(path))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function serverNames(value: unknown): string[] {
  return value && typeof value === 'object' ? Object.keys(value) : []
}

/**
 * De dónde viene cada server configurado. Solo se leen los nombres: nunca
 * `env`, `headers` ni argumentos.
 */
async function collectScopes($: Engine, cwd: string): Promise<Record<string, DietScope>> {
  if (scopesCache && scopesCache.cwd === cwd) return scopesCache.scopes
  const scopes: Record<string, DietScope> = {}
  let home: string | undefined
  try {
    home = await $.env.get('HOME')
  } catch {
    home = undefined
  }
  // De menor a mayor precedencia: user < project < local.
  if (home) {
    const user = await readJson($, `${home}/.claude.json`)
    for (const name of serverNames(user?.mcpServers)) scopes[name] = 'user'
    const project = await readJson($, `${cwd}/.mcp.json`)
    for (const name of serverNames(project?.mcpServers)) scopes[name] = 'project'
    const projects = user?.projects
    const local =
      projects && typeof projects === 'object'
        ? (projects as Record<string, { mcpServers?: unknown }>)[cwd.replace(/\/$/, '')]
        : undefined
    for (const name of serverNames(local?.mcpServers)) scopes[name] = 'local'
  } else {
    const project = await readJson($, `${cwd}/.mcp.json`)
    for (const name of serverNames(project?.mcpServers)) scopes[name] = 'project'
  }
  scopesCache = { cwd, scopes }
  return scopes
}

async function loadHistory($: Engine): Promise<DietHistory> {
  try {
    return sanitizeHistory(await $.store.get(HISTORY_KEY))
  } catch {
    return EMPTY_HISTORY
  }
}

async function isStatusOn($: Engine): Promise<boolean> {
  try {
    return (await $.store.get(STATUS_KEY)) !== false
  } catch {
    return true
  }
}

async function showStatus($: Engine, report: DietReport | null, percent?: number | null) {
  try {
    $.ui.status((await isStatusOn($)) ? statusText(report, percent) : undefined)
  } catch {
    // La línea de estado es una comodidad.
  }
}

/** Mide, arma el reporte, lo publica en `$.state` y guarda el historial. */
async function refresh($: Engine): Promise<DietReport> {
  let cwd = '.'
  try {
    cwd = await $.session.cwd()
  } catch {
    // Se queda el relativo.
  }
  const [usage, counters, history, scopes, now] = await Promise.all([
    $.session.usage({ breakdown: 'summary' }),
    read($, usageAtom),
    loadHistory($),
    collectScopes($, cwd),
    $.clock.now(),
  ])
  const built = buildReport({ usage, counters, history, scopes, cwd, now })
  await update($, reportAtom, () => built.report)
  if (counters.turns > 0) {
    try {
      await $.store.set(HISTORY_KEY, built.history)
    } catch {
      // Sin historial el reporte de la sesión sigue valiendo.
    }
  }
  return built.report
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'diet',
        description: 'Audita el costo de contexto de MCPs, skills, agentes y memoria',
        argumentHint: '[--json | panel | status on|off | reset]',
        immediate: true,
      })
    } catch (error) {
      $.ui.log(`Context Diet: /diet no registrado: ${String(error)}`)
    }
    return next(e)
  })

  // Uso real: llamadas a tools MCP (con su resultado) y subagentes lanzados.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const name = String(e.tool)
      const mcp = parseMcpTool(name)
      const agentType = name === 'Agent' ? (e as { subagent_type?: unknown }).subagent_type : undefined
      if (mcp || name === 'Agent') {
        const isError = ran.deny !== undefined || ran.isError === true
        const now = await $.clock.now()
        await update($, usageAtom, usage =>
          mcp
            ? { ...usage, servers: bump(usage.servers, mcp.server, now, isError) }
            : {
                ...usage,
                agents: bump(usage.agents, typeof agentType === 'string' ? agentType : 'general-purpose', now, isError),
              },
        )
      }
    } catch {
      // Contar nunca debe estorbar a una tool.
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      const group = skillGroupKey(String(e.source), e.pluginName)
      await update($, usageAtom, usage => ({
        ...usage,
        skills: bump(usage.skills, e.skill, now, false),
        skillGroups: bump(usage.skillGroups, group, now, false),
      }))
    } catch {
      // Las skills siguen cargando aunque no se cuenten.
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // Los turnos de un subagente no mueven la ventana principal.
    if (e.agentId === undefined) {
      try {
        const { context } = await $.session.usage()
        await update($, usageAtom, usage => ({
          ...usage,
          turns: usage.turns + 1,
          samples: context.tokens === undefined ? usage.samples : [...usage.samples, context.tokens].slice(-20),
        }))
        await showStatus($, await refresh($))
      } catch {
        // El turno termina igual.
      }
    }
    return next(e)
  })

  // Entre turnos solo se mueve el porcentaje: se reusa el último reporte.
  on('session.measure', async ($, e, next) => {
    try {
      if (e.changed.includes('context')) await showStatus($, await read($, reportAtom), e.context.percent)
    } catch {
      // Observador.
    }
    return next(e)
  })

  on('command.run', { command: 'diet' }, async ($, e) => {
    const args = e.args.trim().toLowerCase()
    if (args === 'help' || args === '--help') return { text: HELP }
    if (args === 'reset') {
      await $.store.delete(HISTORY_KEY)
      await refresh($)
      return { text: 'Context Diet: historial borrado.' }
    }
    if (args.startsWith('status')) {
      const wanted = args.split(/\s+/)[1]
      if (wanted !== 'on' && wanted !== 'off') return { text: 'Uso: /diet status on|off' }
      await $.store.set(STATUS_KEY, wanted === 'on')
      await showStatus($, await refresh($))
      return { text: `Context Diet: línea de estado ${wanted === 'on' ? 'activada' : 'oculta'}.` }
    }
    const report = await refresh($)
    await showStatus($, report)
    if (args === 'panel' || args === '--panel') {
      const { isPlaced } = await $.ui.open({ id: PANE, title: PANE_TITLE })
      return { text: isPlaced ? 'Context Diet: panel abierto.' : renderReport(report) }
    }
    if (args.includes('--json')) return { text: JSON.stringify(report, null, 2) }
    if (args) return { text: `Argumento desconocido: "${e.args.trim()}"\n\n${HELP}` }
    return { text: renderReport(report) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Progress } = $.ui.resolve(e)
    const report = await read($, reportAtom)
    const reload = (
      <Button key="refresh" label="Actualizar" hotkey="r" onPress={() => void refresh($)} />
    )
    if (!report) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Sin medición todavía.</Text>
          {reload}
        </Box>
      )
    }
    const { forecast, totals } = report
    if (e.props.placement === 'widget') {
      return <Text>{statusText(report) ?? PANE_TITLE}</Text>
    }
    const actions = [...report.servers, ...report.skillGroups].filter(item => item.action)
    const servers = report.servers.filter(server => server.isConnected)

    return (
      <Box flexDirection="column">
        <Progress
          label="Contexto"
          value={forecast.used}
          max={Math.max(forecast.threshold, 1)}
          valueText={`${formatTokens(forecast.used)} / ${formatTokens(forecast.threshold)}`}
        />
        <Text>Fijo por request: {formatTokens(totals.fixed)}</Text>
        <Text dimColor>{forecastText(report)}</Text>

        <Text bold>
          {'\n'}MCP · {formatTokens(totals.mcpLoaded)} cargados · {formatTokens(totals.mcpDeferred)} diferidos
        </Text>
        {servers.length === 0 && <Text dimColor>Sin servidores MCP.</Text>}
        {servers.map(server => (
          <Text dimColor={server.verdict === 'used'} wrap="truncate-end">
            {VERDICT_LABEL[server.verdict].padEnd(10)}
            {server.name} · {formatTokens(server.loadedTokens)} · {server.calls} llamadas ·{' '}
            {evidenceText(server.evidence)}
          </Text>
        ))}

        <Text bold>
          {'\n'}Skills · {formatTokens(totals.skills)}
        </Text>
        {report.skillGroups.slice(0, 12).map(group => (
          <Text dimColor={group.verdict === 'used' || group.verdict === 'info'} wrap="truncate-end">
            {VERDICT_LABEL[group.verdict].padEnd(10)}
            {group.label} · {formatTokens(group.tokens)} · {group.loads} cargas
          </Text>
        ))}
        {report.skillGroups.length > 12 && <Text dimColor>… {report.skillGroups.length - 12} más en /diet</Text>}

        <Text dimColor>
          {'\n'}Agentes {formatTokens(totals.agents)} · Memoria {formatTokens(totals.memory)} · Historial{' '}
          {report.history.sessions} sesión(es)
        </Text>

        <Text bold>
          {'\n'}Acciones{actions.length ? ` · −${formatTokens(totals.potentialSaving)} por request` : ''}
        </Text>
        {actions.length === 0 && <Text dimColor>Sin candidatos por ahora.</Text>}
        {actions.map(item => (
          <Text wrap="wrap">{item.action}</Text>
        ))}
        <Text> </Text>
        {reload}
      </Box>
    )
  })
}
