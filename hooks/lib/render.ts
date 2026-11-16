// El reporte como texto plano, y el resumen que comparten texto y dibujo.
import type { DietEvidence, DietLang, DietReport, DietServer, DietSkillGroup } from '../../types'
import { strings } from './i18n'

export function formatTokens(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(value))
}

export function evidenceText(evidence: DietEvidence, lang?: DietLang): string {
  const t = strings(lang)
  if (evidence.sessions === 0) return t.noHistory
  return t.usedIn(evidence.usedSessions, evidence.sessions)
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
  const t = strings(report.lang)
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
    alert = t.alertCandidates(report.totals.candidates, formatTokens(report.totals.potentialSaving))
  } else if (forecast.turnsLeft !== null && forecast.turnsLeft <= 10) {
    alert = t.alertTurns(forecast.turnsLeft, forecast.isAutoCompactEnabled)
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
      .map(row => ({ label: t.category[row.name.toLowerCase()] ?? row.name, tokens: row.tokens }))
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

/** El cambio del fijo desde la primera sesión guardada: `−17k (−26%)`. */
export function changeText(report: DietReport): string {
  const trend = report.trend
  if (!trend || trend.delta === 0) return strings(report.lang).noChange
  const sign = trend.delta < 0 ? '−' : '+'
  return `${sign}${formatTokens(Math.abs(trend.delta))} (${sign}${Math.abs(trend.percent)}%)`
}

export function forecastText(report: DietReport): string {
  const t = strings(report.lang)
  const { forecast } = report
  const room = t.forecast(formatTokens(forecast.headroom), forecast.isAutoCompactEnabled)
  if (forecast.perTurn === null || forecast.turnsLeft === null) return `${room} ${t.forecastUnmeasured}`
  return `${room} · ${t.forecastPace(formatTokens(forecast.perTurn), forecast.turnsLeft)}`
}

export function serverLine(server: DietServer, lang?: DietLang): string {
  const t = strings(lang)
  const history = server.scope === 'host' ? '' : ` · ${evidenceText(server.evidence, lang)}`
  const cost = t.serverLine(
    formatTokens(server.loadedTokens),
    `${server.loadedTools}/${server.tools}`,
    formatTokens(server.deferredTokens),
    server.calls,
    server.errors,
  )
  return `${t.verdict[server.verdict].padEnd(10)}${server.label} [${server.scope}] · ${cost}${history}`
}

export function skillLine(group: DietSkillGroup, lang?: DietLang): string {
  const t = strings(lang)
  const count = group.skills > 1 ? ` · ${group.skills} skills` : ''
  const kind = group.pluginName ? 'plugin' : group.source
  return `${t.verdict[group.verdict].padEnd(10)}${group.label} [${kind}]${count} · ${formatTokens(group.tokens)} · ${t.loads(group.loads)} · ${evidenceText(group.evidence, lang)}`
}

export function noActionsText(report: DietReport): string {
  const t = strings(report.lang)
  const missing = Math.max(0, report.history.minDays - report.history.evidenceDays)
  return missing > 0 ? t.noActionsYet(missing, report.history.minTurns) : t.noActions
}

/** Una celda de tabla markdown: sin saltos de línea ni barras sueltas. */
const cell = (value: string | number) => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

function table(head: string[], rows: (string | number)[][]): string[] {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ]
}

const code = (text: string) => `\`${text}\``

/**
 * El reporte completo (`/diet --all`) como markdown: una tabla por tema, que
 * la fila del transcript dibuja como dibuja cualquier respuesta.
 */
export function renderDetail(report: DietReport): string {
  const t = strings(report.lang)
  const d = t.detail
  const summary = summarize(report)
  const { forecast, totals } = report
  const history = (evidence: DietEvidence) => evidenceText(evidence, report.lang)
  const lines: string[] = [`${reportStamp(report)}${report.model ? ` · ${report.model}` : ''} · ${d.tag}`, '']
  const section = (title: string, note: string, body: string[]) => {
    lines.push(`**${title}**${note ? ` · ${note}` : ''}`, '', ...body, '')
  }

  const percent = report.percent == null ? '' : ` (${report.percent}%)`
  section(d.context, d.fixedShare(summary.fixedPercent), table([d.concept, d.tokens], [
    [d.fixed, `~${formatTokens(totals.fixed)}`],
    [d.conversation, formatTokens(forecast.conversation)],
    [d.inUse, `${d.inUseValue(formatTokens(report.tokens ?? forecast.used), formatTokens(report.window))}${percent}`],
    [d.freeUntil(forecast.isAutoCompactEnabled), formatTokens(forecast.headroom)],
    [d.perTurn, forecast.perTurn === null ? d.unmeasured : `~${formatTokens(forecast.perTurn)}`],
    [d.turnsLeft, forecast.turnsLeft === null ? d.unmeasured : `~${forecast.turnsLeft}`],
    ...(report.trend
      ? [
          [d.trendThen(t.trendWhen(report.trend.days)), `~${formatTokens(report.trend.baseline)}`],
          [d.trendChange, changeText(report)],
        ]
      : []),
  ]))

  section(d.madeOf, '', table([d.part, d.tokens], summary.composition.map(part => [part.label, formatTokens(part.tokens)])))

  const own = [...summary.shown, ...summary.idle]
  section(
    d.servers,
    `${own.length + summary.missing.length}`,
    own.length + summary.missing.length === 0
      ? [d.noServers]
      : table(d.serverHead, [
          ...own.map(server => [
            code(t.verdict[server.verdict]),
            server.label,
            server.scope,
            formatTokens(server.loadedTokens),
            `${server.loadedTools}/${server.tools}`,
            formatTokens(server.deferredTokens),
            server.errors ? d.withErrors(server.calls, server.errors) : server.calls,
            history(server.evidence),
          ]),
          ...summary.missing.map(server => [code(t.noTools), server.label, server.scope, '?', '?', '?', 0, t.disconnected]),
        ]),
  )

  const host = report.servers.filter(one => one.isConnected && one.scope === 'host')
  if (host.length) {
    section(
      d.host,
      d.hostNote(host.length, formatTokens(summary.host.loadedTokens)),
      table(d.hostHead, host.map(server => [
        server.label,
        formatTokens(server.loadedTokens),
        `${server.loadedTools}/${server.tools}`,
        formatTokens(server.deferredTokens),
        server.calls,
      ])),
    )
  }
  lines.push(d.deferred(summary.deferred.servers, formatTokens(summary.deferred.tokens)), '')

  section(d.skills, d.skillsNote(formatTokens(totals.skills)), table(d.skillHead, summary.skills.map(group => [
    code(t.verdict[group.verdict]),
    group.label,
    group.pluginName ? 'plugin' : group.source,
    group.skills,
    formatTokens(group.tokens),
    group.loads,
    history(group.evidence),
  ])))

  if (report.agents.length) {
    section(d.agents, `${report.agents.length} · ${formatTokens(totals.agents)}`, table(d.agentHead, report.agents.map(agent => [
      agent.agentType,
      agent.source,
      formatTokens(agent.tokens),
      agent.calls,
    ])))
  }
  if (report.memory.length) {
    section(d.memory, `${report.memory.length} · ${formatTokens(totals.memory)}`, table(d.memoryHead, report.memory.map(file => [
      code(file.path),
      file.type,
      formatTokens(file.tokens),
      file.isHeavy ? code(t.heavy) : '',
    ])))
  }

  const heavy = report.memory.filter(file => file.isHeavy)
  section(
    d.actions,
    summary.actions.length ? d.saving(formatTokens(totals.potentialSaving)) : '',
    summary.actions.length + heavy.length === 0
      ? [noActionsText(report)]
      : table(d.actionHead, [
          // Solo un comando va como código; una indicación es prosa.
          ...summary.actions.map(item => [
            `−${formatTokens(item.saving)}`,
            /^claude /.test(item.action ?? '') ? code(item.action ?? '') : (item.action ?? ''),
          ]),
          ...heavy.map(file => [formatTokens(file.tokens), d.trim(code(file.path))]),
        ]),
  )

  lines.push(historyNote(report, code(t.verdict.candidate)))
  return lines.join('\n')
}

function historyNote(report: DietReport, candidate: string): string {
  const { history } = report
  return strings(report.lang).historyNote(history.sessions, history.days, history.minDays, history.minTurns, candidate)
}

/**
 * El reporte como texto. Es también lo que queda en el transcript, así que el
 * resumen es corto; `isDetailed` (`/diet --all`) lo da entero, en tablas.
 */
export function renderReport(report: DietReport, options: { isDetailed?: boolean } = {}): string {
  if (options.isDetailed) return renderDetail(report)
  const t = strings(report.lang)
  const x = t.text
  const summary = summarize(report)
  const { forecast, totals } = report
  const lines: string[] = []
  lines.push(`${reportStamp(report)}${report.model ? ` · ${report.model}` : ''}`)
  lines.push('')

  const percent = report.percent == null ? '' : ` (${report.percent}%)`
  const live = formatTokens(report.tokens ?? forecast.used)
  const pad = Math.max(x.inUse.length, x.forecast.length, x.madeOf.length, x.diet.length) + 2
  lines.push(x.fixed(formatTokens(totals.fixed), summary.fixedPercent))
  lines.push(`  ${x.inUse.padEnd(pad)}${live} / ${formatTokens(report.window)}${percent}`)
  lines.push(`  ${x.forecast.padEnd(pad)}${forecastText(report)}`)
  lines.push(`  ${x.madeOf.padEnd(pad)}${summary.composition.map(part => `${part.label} ${formatTokens(part.tokens)}`).join(' · ')}`)
  if (report.trend) {
    const then = formatTokens(report.trend.baseline)
    lines.push(`  ${x.diet.padEnd(pad)}${x.trend(t.trendWhen(report.trend.days), then, formatTokens(totals.fixed), changeText(report))}`)
  }
  lines.push('')

  const own = summary.shown.length + summary.idle.length
  lines.push(x.servers(own))
  if (!own && !summary.missing.length) lines.push(`  ${x.none}`)
  for (const server of summary.shown) lines.push(`  ${serverLine(server, report.lang)}`)
  if (summary.idle.length) lines.push(`  ${x.idle(summary.idle.map(server => server.label).join(', '))}`)
  for (const server of summary.missing) {
    lines.push(`  ${t.noTools.padEnd(10)}${server.label} [${server.scope}] · ${t.disconnected}`)
  }
  lines.push('')

  if (summary.host.servers) lines.push(x.host(summary.host.servers, formatTokens(summary.host.loadedTokens)))
  lines.push(x.deferred(summary.deferred.servers, formatTokens(summary.deferred.tokens)))
  lines.push('')

  lines.push(x.skills(formatTokens(totals.skills)))
  const skills = summary.skills.slice(0, 5)
  for (const group of skills) lines.push(`  ${skillLine(group, report.lang)}`)
  if (summary.skills.length > skills.length) lines.push(`  ${x.more(summary.skills.length - skills.length)}`)
  lines.push('')

  const heavy = report.memory.filter(file => file.isHeavy)
  lines.push(
    x.agentsMemory(report.agents.length, formatTokens(totals.agents), report.memory.length, formatTokens(totals.memory), heavy.length),
  )
  for (const file of heavy) lines.push(`  ${t.heavy} ${file.path} [${file.type}] · ${formatTokens(file.tokens)}`)
  lines.push('')

  lines.push(x.actions)
  if (!summary.actions.length) lines.push(`  ${noActionsText(report)}`)
  else {
    lines.push(`  ${x.saving(formatTokens(totals.potentialSaving))}`)
    for (const item of summary.actions) lines.push(`  ${item.action}   # −${formatTokens(item.saving)}`)
  }
  if (heavy.length) lines.push(`  ${x.trimMemory(heavy.length)}`)
  lines.push('')
  lines.push(`${historyNote(report, t.verdict.candidate)} ${t.moreDetail}`)
  return lines.join('\n')
}
