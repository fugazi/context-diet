// El reporte como texto plano, y el resumen que comparten texto y dibujo.
import type { DietEvidence, DietReport, DietServer, DietSkillGroup, DietVerdict } from '../../types'

export function formatTokens(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(value))
}

export const VERDICT_LABEL: Record<DietVerdict, string> = {
  used: 'USADO',
  occasional: 'OCASIONAL',
  candidate: 'CANDIDATO',
  watch: 'OBSERVAR',
  info: 'FIJO',
}

/** Las filas de /context, en castellano; una fila nueva conserva su nombre. */
const CATEGORY_LABEL: Record<string, string> = {
  'system prompt': 'Prompt del sistema',
  'system tools': 'Tools del sistema',
  'mcp tools': 'Tools MCP cargadas',
  'mcp server instructions': 'Instrucciones MCP',
  'custom agents': 'Agentes',
  skills: 'Skills',
  'memory files': 'Memoria',
}

export function evidenceText(evidence: DietEvidence): string {
  if (evidence.sessions === 0) return 'sin historial'
  return `usado en ${evidence.usedSessions}/${evidence.sessions} sesiones`
}

/** La primera línea del texto: identifica qué reporte imprimió una fila. */
export function reportStamp(report: DietReport): string {
  return `Context Diet · ${new Date(report.generatedAt).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

export type DietSummary = {
  /** Reparto de la ventana (hasta el umbral de compactación), en fracciones. */
  share: { fixed: number; conversation: number; free: number }
  /** Qué parte de lo usado es overhead fijo, 0 a 100. */
  fixedPercent: number
  /** De qué está hecho el fijo, de mayor a menor. */
  composition: { label: string; tokens: number }[]
  /** Servers tuyos que pesan, se usan o tienen veredicto: van uno por línea. */
  shown: DietServer[]
  /** Servers tuyos sin costo ni uso: van en una línea. */
  idle: DietServer[]
  /** Servers configurados que no aportaron tools. */
  missing: DietServer[]
  /** Lo que aporta la app o un plugin, agregado. */
  host: { servers: number; loadedTokens: number; deferredTokens: number; calls: number }
  deferred: { servers: number; tokens: number }
  usedServers: number
  skills: DietSkillGroup[]
  actions: (DietServer | DietSkillGroup)[]
  /** Lo que merece un aviso sin que nadie pregunte; null si no hay nada. */
  alert: string | null
}

export function summarize(report: DietReport): DietSummary {
  const { forecast } = report
  const total = Math.max(forecast.threshold, forecast.used, 1)
  const connected = report.servers.filter(server => server.isConnected)
  const own = connected.filter(server => server.scope !== 'host')
  const host = connected.filter(server => server.scope === 'host')
  const matters = (server: DietServer) =>
    server.loadedTokens > 0 || server.calls > 0 || server.verdict === 'candidate' || server.verdict === 'occasional'
  const actions = [...report.servers, ...report.skillGroups].filter(item => item.action)

  let alert: string | null = null
  if (report.totals.candidates > 0) {
    const count = report.totals.candidates
    alert = `${count} candidato${count === 1 ? '' : 's'} a apagar · −${formatTokens(report.totals.potentialSaving)} por request`
  } else if (forecast.turnsLeft !== null && forecast.turnsLeft <= 10) {
    alert = `~${forecast.turnsLeft} turnos hasta ${forecast.isAutoCompactEnabled ? 'la compactación' : 'llenar la ventana'}`
  }

  return {
    share: {
      fixed: forecast.fixed / total,
      conversation: forecast.conversation / total,
      free: Math.max(0, total - forecast.used) / total,
    },
    fixedPercent: forecast.used > 0 ? Math.round((forecast.fixed / forecast.used) * 100) : 0,
    composition: report.categories
      .filter(row => row.kind === 'used' && !/^messages$/i.test(row.name) && row.tokens > 0)
      .map(row => ({ label: CATEGORY_LABEL[row.name.toLowerCase()] ?? row.name, tokens: row.tokens }))
      .sort((a, b) => b.tokens - a.tokens),
    shown: own.filter(matters),
    idle: own.filter(server => !matters(server)),
    missing: report.servers.filter(server => !server.isConnected),
    host: {
      servers: host.length,
      loadedTokens: host.reduce((sum, server) => sum + server.loadedTokens, 0),
      deferredTokens: host.reduce((sum, server) => sum + server.deferredTokens, 0),
      calls: host.reduce((sum, server) => sum + server.calls, 0),
    },
    deferred: {
      servers: connected.filter(server => server.deferredTokens > 0).length,
      tokens: report.totals.mcpDeferred,
    },
    usedServers: connected.filter(server => server.calls > 0).length,
    skills: report.skillGroups,
    actions,
    alert,
  }
}

export function forecastText(report: DietReport): string {
  const { forecast } = report
  const target = forecast.isAutoCompactEnabled ? 'la compactación' : 'llenar la ventana'
  const room = `${formatTokens(forecast.headroom)} hasta ${target}`
  if (forecast.perTurn === null || forecast.turnsLeft === null) return `${room} (sin ritmo medido aún)`
  return `${room} · ~${formatTokens(forecast.perTurn)}/turno → ~${forecast.turnsLeft} turnos`
}

export function serverLine(server: DietServer): string {
  const errors = server.errors ? ` (${server.errors} con error)` : ''
  const history = server.scope === 'host' ? '' : ` · ${evidenceText(server.evidence)}`
  return `${VERDICT_LABEL[server.verdict].padEnd(10)}${server.label} [${server.scope}] · ${formatTokens(server.loadedTokens)} cargados (${server.loadedTools}/${server.tools} tools) · ${formatTokens(server.deferredTokens)} diferidos · ${server.calls} llamadas${errors}${history}`
}

export function skillLine(group: DietSkillGroup): string {
  const count = group.skills > 1 ? ` · ${group.skills} skills` : ''
  const kind = group.pluginName ? 'plugin' : group.source
  return `${VERDICT_LABEL[group.verdict].padEnd(10)}${group.label} [${kind}]${count} · ${formatTokens(group.tokens)} · ${group.loads} cargas · ${evidenceText(group.evidence)}`
}

export function noActionsText(report: DietReport): string {
  const missing = Math.max(0, report.history.minSessions - report.history.sessions)
  return missing > 0
    ? `aún sin candidatos: faltan ${missing} sesión(es) de historial para emitir veredictos`
    : 'sin candidatos: todo lo tuyo se usó alguna vez'
}

/**
 * El reporte como texto. Es también lo que queda en el transcript, así que el
 * resumen es corto; `isDetailed` (`/diet --all`) lista cada server y skill.
 */
export function renderReport(report: DietReport, options: { isDetailed?: boolean } = {}): string {
  const summary = summarize(report)
  const { forecast, totals } = report
  const lines: string[] = []
  lines.push(`${reportStamp(report)}${report.model ? ` · ${report.model}` : ''}${options.isDetailed ? ' · detalle' : ''}`)
  lines.push('')

  const percent = report.percent == null ? '' : ` (${report.percent}%)`
  const live = formatTokens(report.tokens ?? forecast.used)
  lines.push(`FIJO ${formatTokens(totals.fixed)} por request · ${summary.fixedPercent}% de lo usado`)
  lines.push(`  en uso      ${live} / ${formatTokens(report.window)}${percent}`)
  lines.push(`  pronóstico  ${forecastText(report)}`)
  lines.push(`  hecho de    ${summary.composition.map(part => `${part.label} ${formatTokens(part.tokens)}`).join(' · ')}`)
  lines.push('')

  const own = summary.shown.length + summary.idle.length
  lines.push(`TUS SERVIDORES MCP (${own})`)
  if (!own && !summary.missing.length) lines.push('  ninguno')
  for (const server of options.isDetailed ? [...summary.shown, ...summary.idle] : summary.shown) {
    lines.push(`  ${serverLine(server)}`)
  }
  if (!options.isDetailed && summary.idle.length) {
    lines.push(`  sin costo ni uso: ${summary.idle.map(server => server.label).join(', ')} (diferidos, 0 por request)`)
  }
  for (const server of summary.missing) {
    lines.push(`  ${'SIN TOOLS'.padEnd(10)}${server.label} [${server.scope}] · desconectado o aún conectando`)
  }
  lines.push('')

  if (summary.host.servers) {
    lines.push(
      `APP DE CLAUDE Y PLUGINS · ${summary.host.servers} servers · ${formatTokens(summary.host.loadedTokens)} cargados · fijo, no se quita desde tu config`,
    )
    if (options.isDetailed) {
      for (const server of report.servers.filter(one => one.isConnected && one.scope === 'host')) {
        lines.push(`  ${serverLine(server)}`)
      }
    }
  }
  lines.push(`DIFERIDO · ${summary.deferred.servers} servers · ${formatTokens(summary.deferred.tokens)} tras ToolSearch · 0 por request`)
  lines.push('')

  lines.push(`SKILLS · ${formatTokens(totals.skills)} en el listado`)
  const skills = options.isDetailed ? summary.skills : summary.skills.slice(0, 5)
  for (const group of skills) lines.push(`  ${skillLine(group)}`)
  if (summary.skills.length > skills.length) lines.push(`  … ${summary.skills.length - skills.length} más`)
  lines.push('')

  const heavy = report.memory.filter(file => file.isHeavy)
  lines.push(
    `AGENTES ${report.agents.length} · ${formatTokens(totals.agents)}   MEMORIA ${report.memory.length} · ${formatTokens(totals.memory)}${heavy.length ? ` (${heavy.length} pesado${heavy.length === 1 ? '' : 's'})` : ''}`,
  )
  if (options.isDetailed) {
    for (const agent of report.agents) {
      lines.push(`  ${agent.agentType} [${agent.source}] · ${formatTokens(agent.tokens)} · ${agent.calls} usos`)
    }
    for (const file of report.memory) {
      lines.push(`  ${file.isHeavy ? 'PESADO ' : ''}${file.path} [${file.type}] · ${formatTokens(file.tokens)}`)
    }
  } else {
    for (const file of heavy) lines.push(`  PESADO ${file.path} [${file.type}] · ${formatTokens(file.tokens)}`)
  }
  lines.push('')

  lines.push('ACCIONES')
  if (!summary.actions.length) lines.push(`  ${noActionsText(report)}`)
  else {
    lines.push(`  ahorro potencial: ${formatTokens(totals.potentialSaving)} por request`)
    for (const item of summary.actions) lines.push(`  ${item.action}   # −${formatTokens(item.saving)}`)
  }
  if (heavy.length) lines.push(`  recorta ${heavy.length} archivo(s) de memoria pesado(s): se envían enteros en cada request`)
  lines.push('')
  lines.push(
    `Historial: ${report.history.sessions} sesión(es) en ${report.history.days} día(s). CANDIDATO = sin uso en ${report.history.minSessions}+ sesiones. Tokens estimados como en /context.${options.isDetailed ? '' : ' Detalle: /diet --all.'}`,
  )
  return lines.join('\n')
}
