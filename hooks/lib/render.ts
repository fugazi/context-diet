// El reporte como texto plano: lo que `/diet` imprime en el transcript.
import type { DietEvidence, DietReport, DietVerdict } from '../../types'

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

export function evidenceText(evidence: DietEvidence): string {
  if (evidence.sessions === 0) return 'sin historial'
  return `usado en ${evidence.usedSessions}/${evidence.sessions} sesiones`
}

/** Una línea para la status line; null si aún no hay nada que decir. */
export function statusText(report: DietReport | null, percent?: number | null): string | undefined {
  if (!report) return undefined
  const shown = percent ?? report.percent
  const parts = [`diet ${shown == null ? '–' : `${shown}%`}`, `fijo ${formatTokens(report.totals.fixed)}`]
  if (report.totals.candidates > 0) {
    parts.push(`${report.totals.candidates} candidato${report.totals.candidates === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

export function forecastText(report: DietReport): string {
  const { forecast } = report
  const target = forecast.isAutoCompactEnabled ? 'la compactación' : 'llenar la ventana'
  const room = `${formatTokens(forecast.headroom)} hasta ${target}`
  if (forecast.perTurn === null || forecast.turnsLeft === null) return `${room} (sin ritmo medido aún)`
  return `${room} · ~${formatTokens(forecast.perTurn)}/turno → ~${forecast.turnsLeft} turnos`
}

export function renderReport(report: DietReport): string {
  const lines: string[] = []
  const pad = (label: string) => label.padEnd(10)
  const stamp = new Date(report.generatedAt).toISOString().slice(0, 19).replace('T', ' ')
  lines.push(`Context Diet · ${stamp} UTC${report.model ? ` · ${report.model}` : ''}`)
  lines.push('')

  lines.push('CONTEXTO')
  const percent = report.percent == null ? '' : ` (${report.percent}%)`
  const live = report.tokens == null ? formatTokens(report.forecast.used) : formatTokens(report.tokens)
  lines.push(`  en uso      ${live} / ${formatTokens(report.window)}${percent}`)
  lines.push(`  fijo        ${formatTokens(report.totals.fixed)} por request, antes de la conversación`)
  lines.push(`  pronóstico  ${forecastText(report)}`)
  lines.push('')

  const connected = report.servers.filter(server => server.isConnected)
  lines.push(
    `MCP (${connected.length}) · ${formatTokens(report.totals.mcpLoaded)} cargados · ${formatTokens(report.totals.mcpDeferred)} diferidos (0 por request) · ${formatTokens(report.totals.mcpInstructions)} en instrucciones`,
  )
  if (!report.servers.length) lines.push('  sin servidores MCP en la sesión')
  for (const server of report.servers) {
    if (!server.isConnected) {
      lines.push(`  ${pad('SIN TOOLS')}${server.name} [${server.scope}] · configurado, sin tools en la sesión (desconectado o aún conectando)`)
      continue
    }
    const errors = server.errors ? ` (${server.errors} con error)` : ''
    lines.push(
      `  ${pad(VERDICT_LABEL[server.verdict])}${server.name} [${server.scope}] · ${formatTokens(server.loadedTokens)} cargados (${server.loadedTools}/${server.tools} tools) · ${formatTokens(server.deferredTokens)} diferidos · ${server.calls} llamadas${errors} · ${evidenceText(server.evidence)}`,
    )
  }
  lines.push('')

  lines.push(`SKILLS · ${formatTokens(report.totals.skills)} en el listado`)
  if (!report.skillGroups.length) lines.push('  sin skills listadas')
  for (const group of report.skillGroups) {
    const count = group.skills > 1 ? ` · ${group.skills} skills` : ''
    const kind = group.pluginName ? 'plugin' : group.source
    lines.push(
      `  ${pad(VERDICT_LABEL[group.verdict])}${group.label} [${kind}]${count} · ${formatTokens(group.tokens)} · ${group.loads} cargas · ${evidenceText(group.evidence)}`,
    )
  }
  lines.push('')

  if (report.agents.length) {
    lines.push(`AGENTES (${report.agents.length}) · ${formatTokens(report.totals.agents)}`)
    for (const agent of report.agents.slice(0, 6)) {
      lines.push(`  ${agent.agentType} [${agent.source}] · ${formatTokens(agent.tokens)} · ${agent.calls} usos`)
    }
    if (report.agents.length > 6) lines.push(`  … ${report.agents.length - 6} más`)
    lines.push('')
  }

  if (report.memory.length) {
    lines.push(`MEMORIA (${report.memory.length}) · ${formatTokens(report.totals.memory)}`)
    for (const file of report.memory.slice(0, 6)) {
      lines.push(`  ${file.isHeavy ? 'PESADO  ' : '        '}${file.path} [${file.type}] · ${formatTokens(file.tokens)}`)
    }
    if (report.memory.length > 6) lines.push(`  … ${report.memory.length - 6} más`)
    lines.push('')
  }

  const actions = [...report.servers, ...report.skillGroups].filter(item => item.action)
  lines.push('ACCIONES')
  if (!actions.length) {
    const missing = Math.max(0, report.history.minSessions - report.history.sessions)
    lines.push(
      missing > 0
        ? `  aún sin candidatos: faltan ${missing} sesión(es) de historial para emitir veredictos`
        : '  sin candidatos: todo lo presente se usó alguna vez',
    )
  } else {
    lines.push(`  ahorro potencial: ${formatTokens(report.totals.potentialSaving)} por request`)
    for (const item of actions) lines.push(`  ${item.action}   # −${formatTokens(item.saving)}`)
  }
  const heavy = report.memory.filter(file => file.isHeavy)
  if (heavy.length) lines.push(`  recorta ${heavy.length} archivo(s) de memoria pesado(s): se envían enteros en cada request`)
  lines.push('')
  lines.push(
    `Historial: ${report.history.sessions} sesión(es) en ${report.history.days} día(s). CANDIDATO = sin uso en ${report.history.minSessions}+ sesiones. Tokens: desglose de /context (estimado local). Nada se desactiva solo.`,
  )
  return lines.join('\n')
}
