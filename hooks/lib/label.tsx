// El reporte dibujado como un tablero: un recuadro de color por tema (lo fijo,
// lo que queda, MCP, skills, acciones), con filas de puntos guía. En el panel
// cada cabecera pliega su recuadro. Un mismo árbol para cada superficie.
import type { DietReport, DietVerdict } from '../../types'
import { LANGS, strings } from './i18n'
import { changeText, formatTokens, noActionsText, summarize } from './render'

/** La tabla de elementos de la superficie, de `$.ui.resolve(e)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Kit = { Box: any; Text: any; Button?: any }

/** Los recuadros, en el orden en que se dibujan; su tecla es su posición. */
export const SECTIONS = ['fixed', 'left', 'mcp', 'skills', 'actions'] as const
export type DietSection = (typeof SECTIONS)[number]

/** Un color por recuadro: borde, título y su marca en la leyenda. */
const SECTION_COLOR: Record<DietSection, string> = {
  fixed: 'warning',
  left: 'success',
  mcp: 'suggestion',
  skills: 'merged',
  actions: 'claude',
}

/** Lo que el panel añade a la etiqueta: lo que se puede pulsar. */
export type DietPanel = {
  /** Los recuadros plegados. */
  folded: readonly string[]
  onFold: (section: DietSection) => void
}

const VERDICT_COLOR: Record<DietVerdict, string> = {
  used: 'success',
  occasional: 'suggestion',
  candidate: 'warning',
  watch: 'subtle',
  info: 'inactive',
}

const FIXED_COLOR = 'warning'
const CONVERSATION_COLOR = 'suggestion'

export const LABEL_MIN_WIDTH = 44
export const LABEL_MAX_WIDTH = 64

/** Filas de cada lista en el resumen; `isDetailed` las muestra todas. */
const SUMMARY_PARTS = 4
const SUMMARY_SKILLS = 4

/** Ancho de la columna de historial: `12/30`. */
const HISTORY_CELLS = 5

/** En cuántas sesiones del historial se usó, de las que lo tuvieron presente. */
export function historyCell(evidence: { sessions: number; usedSessions: number }): string {
  return evidence.sessions === 0 ? '—' : `${evidence.usedSessions}/${evidence.sessions}`
}

/** Ancho de la columna de veredicto: el del más largo. */
const TAG_CELLS = Math.max(
  ...LANGS.flatMap(lang => [...Object.values(strings(lang).verdict), strings(lang).noTools]).map(text => text.length),
)

/** Ancho interior de la etiqueta para las columnas disponibles. */
export function labelWidth(columns: number | undefined): number {
  return Math.max(LABEL_MIN_WIDTH, Math.min(LABEL_MAX_WIDTH, (columns ?? 72) - 6))
}

/** Reparte `cells` celdas entre las partes, sin perder ninguna por redondeo. */
export function splitCells(shares: number[], cells: number): number[] {
  const sizes = shares.map(share => (share > 0 ? Math.max(1, Math.round(share * cells)) : 0))
  let extra = sizes.reduce((sum, size) => sum + size, 0) - cells
  while (extra !== 0) {
    // El ajuste va a la parte más grande, que es donde menos se nota.
    const index = sizes.indexOf(Math.max(...sizes))
    const step = extra > 0 ? -1 : 1
    sizes[index] = (sizes[index] ?? 0) + step
    extra += step
  }
  return sizes
}

/**
 * Una fila de `width` celdas exactas: nombre, puntos guía y valor. El nombre
 * se recorta antes que el valor.
 */
export function leaderCells(name: string, value: string, width: number): { name: string; dots: string } {
  const room = Math.max(4, width - value.length - 2)
  const shown = name.length > room - 2 ? `${name.slice(0, Math.max(1, room - 3))}…` : name
  return { name: shown, dots: '.'.repeat(Math.max(0, room - shown.length)) }
}

const FIXED_VERDICTS: ReadonlySet<DietVerdict> = new Set(['info'])

const percent = (share: number) => `${Math.round(share * 100)}%`

/** Lo que ocupan, tras el valor, las columnas de historial y veredicto. */
const TAIL_CELLS = HISTORY_CELLS + TAG_CELLS + 4

type RowOptions = {
  /** Color del punto y del veredicto. */
  color?: string
  /** El punto de estado delante del nombre. */
  mark?: string
  /** El veredicto, en su columna a la derecha. */
  tag?: string
  /** `usadas/sesiones`, en su columna antes del veredicto. */
  history?: string
  isDim?: boolean
  isStrong?: boolean
}

export function label(
  kit: Kit,
  report: DietReport,
  options: { width: number; isDetailed?: boolean; panel?: DietPanel },
) {
  const { Box, Text, Button } = kit
  const panel = Button ? options.panel : undefined
  const width = options.width
  const t = strings(report.lang)
  const p = t.panel
  const summary = summarize(report)
  const { forecast, totals } = report
  const connected = report.servers.filter(server => server.isConnected)
  const [fixedCells = 0, conversationCells = 0, freeCells = 0] = splitCells(
    [summary.share.fixed, summary.share.conversation, summary.share.free],
    width,
  )

  const dashes = () => (
    <Text mono dimColor wrap="truncate-end">
      {'- '.repeat(Math.ceil(width / 2)).slice(0, width)}
    </Text>
  )

  const row = (name: string, value: string, opts: RowOptions = {}) => {
    const lead = opts.mark ? 2 : 0
    const tail = opts.tag === undefined ? 0 : TAIL_CELLS
    const cells = leaderCells(name, value, width - lead - tail)
    return (
      <Text mono wrap="truncate-end">
        {opts.mark && (
          <Text mono color={opts.color}>
            {opts.mark}{' '}
          </Text>
        )}
        <Text mono dimColor={opts.isDim} bold={opts.isStrong} color={opts.isStrong ? opts.color : undefined}>
          {cells.name}
        </Text>
        <Text mono dimColor>
          {' '}
          {cells.dots}{' '}
        </Text>
        <Text mono tabular bold={!opts.isDim} dimColor={opts.isDim} color={opts.isStrong ? opts.color : undefined}>
          {value}
        </Text>
        {opts.tag !== undefined && (
          <Text mono dimColor>
            {'  '}
            {(opts.history ?? '').padStart(HISTORY_CELLS)}
          </Text>
        )}
        {opts.tag !== undefined && (
          <Text mono color={opts.color}>
            {'  '}
            {opts.tag.padStart(TAG_CELLS)}
          </Text>
        )}
      </Text>
    )
  }

  /** Los títulos de las columnas de una lista con veredicto, sobre sus valores. */
  const columns = () => (
    <Text mono dimColor wrap="truncate-end">
      {p.columns.tokens.padStart(width - TAIL_CELLS)}
      {'  '}
      {p.columns.used.padStart(HISTORY_CELLS)}
      {'  '}
      {p.columns.verdict.padStart(TAG_CELLS)}
    </Text>
  )

  /** Un estado: verde encendido, apagado en gris. */
  const state = (name: string, isOn: boolean) => (
    <Text mono>
      <Text mono dimColor>
        {name}{' '}
      </Text>
      <Text mono bold={isOn} dimColor={!isOn} color={isOn ? 'success' : undefined}>
        {isOn ? '● on' : '○ off'}
      </Text>
    </Text>
  )

  /**
   * Un recuadro de su color: título, total a la derecha y el cuerpo. En el
   * panel el título es un botón que lo pliega; plegado conserva su total.
   */
  const card = (id: DietSection, title: string, meta: string, body: () => unknown[]) => {
    const color = SECTION_COLOR[id]
    const isFolded = panel?.folded.includes(id) ?? false
    const name = (
      <Text mono bold color={color}>
        {panel ? (isFolded ? '▸ ' : '▾ ') : ''}
        {title}
      </Text>
    )
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={color} borderDimColor={isFolded} paddingX={1} width={width + 4}>
        <Box flexDirection="row" justifyContent="space-between" width={width}>
          {panel ? (
            <Button key={`fold-${id}`} plain hotkey={String(SECTIONS.indexOf(id) + 1)} onPress={() => panel.onFold(id)}>
              {name}
            </Button>
          ) : (
            name
          )}
          <Text mono dimColor>
            {meta}
          </Text>
        </Box>
        {!isFolded && dashes()}
        {!isFolded && body().filter(Boolean)}
      </Box>
    )
  }

  const parts = options.isDetailed ? summary.composition : summary.composition.slice(0, SUMMARY_PARTS)
  const otherParts = summary.composition.slice(parts.length)
  const servers = options.isDetailed ? [...summary.shown, ...summary.idle] : summary.shown
  const hostServers = options.isDetailed ? connected.filter(server => server.scope === 'host') : []
  const skillRows = options.isDetailed ? summary.skills : summary.skills.slice(0, SUMMARY_SKILLS)
  const otherSkills = summary.skills.slice(skillRows.length)
  const heavy = report.memory.filter(file => file.isHeavy)
  const hasOwn = servers.length > 0 || summary.missing.length > 0
  const turnsColor = forecast.turnsLeft !== null && forecast.turnsLeft <= 10 ? 'warning' : 'success'
  const leftMeta = forecast.turnsLeft !== null ? p.turnsMeta(forecast.turnsLeft) : p.freeMeta(formatTokens(forecast.headroom))
  const hasActions = summary.actions.length > 0 || heavy.length > 0
  const actionsMeta =
    totals.potentialSaving > 0 ? p.savingMeta(formatTokens(totals.potentialSaving)) : hasActions ? p.pending : p.nothingPending
  const ownLoaded = summary.shown.reduce((sum, server) => sum + server.loadedTokens, 0)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" width={width + 4} paddingX={2}>
        <Text mono bold>
          Context Diet
        </Text>
        {row(p.model, report.model || p.noModel, { isDim: true })}
        <Text mono wrap="truncate-end">
          {SECTIONS.map((id, index) => (
            <Text mono color={SECTION_COLOR[id]}>
              {index ? '  ' : ''}■ {p.legend[id]}
            </Text>
          ))}
        </Text>
        {state(p.autoCompact, forecast.isAutoCompactEnabled)}
      </Box>

      {card('fixed', p.fixedTitle, `~${formatTokens(totals.fixed)}`, () => [
        <Text mono dimColor wrap="wrap">
          {p.fixedIntro}
        </Text>,
        dashes(),
        row(p.fixed, `~${formatTokens(totals.fixed)}`, { color: FIXED_COLOR, isStrong: true }),
        row(p.conversation, formatTokens(forecast.conversation), { color: CONVERSATION_COLOR, isStrong: true }),
        row(p.window, formatTokens(report.window)),
        <Box flexDirection="row" width={width} height={1}>
          {fixedCells > 0 && <Box width={fixedCells} height={1} backgroundColor={FIXED_COLOR} />}
          {conversationCells > 0 && <Box width={conversationCells} height={1} backgroundColor={CONVERSATION_COLOR} />}
          {freeCells > 0 && <Box width={freeCells} height={1} backgroundColor="subtle" />}
        </Box>,
        <Box flexDirection="row" justifyContent="space-between" width={width}>
          <Text mono color={FIXED_COLOR}>
            ■ {percent(summary.share.fixed)} {p.shareFixed}
          </Text>
          <Text mono color={CONVERSATION_COLOR}>
            ■ {percent(summary.share.conversation)} {p.shareConversation}
          </Text>
          <Text mono dimColor>
            ■ {percent(summary.share.free)} {p.shareFree}
          </Text>
        </Box>,
        dashes(),
        <Text mono bold>
          {p.madeOf}
        </Text>,
        ...parts.map(part => row(part.label, formatTokens(part.tokens))),
        otherParts.length > 0 &&
          row(p.others(otherParts.length), formatTokens(otherParts.reduce((sum, part) => sum + part.tokens, 0)), {
            isDim: true,
          }),
        dashes(),
        <Text mono bold>
          {p.trendTitle}
        </Text>,
        // La dieta en una cifra: el fijo de la primera sesión guardada contra el de ahora.
        report.trend && row(t.trendWhen(report.trend.days), `~${formatTokens(report.trend.baseline)}`),
        report.trend &&
          row(p.trendChange, changeText(report), {
            color: report.trend.delta < 0 ? 'success' : report.trend.delta > 0 ? 'warning' : undefined,
            isStrong: report.trend.delta !== 0,
          }),
        !report.trend && (
          <Text mono dimColor wrap="wrap">
            {p.trendNone}
          </Text>
        ),
      ])}

      {card('left', p.leftTitle(forecast.isAutoCompactEnabled), leftMeta, () => [
        row(p.free, formatTokens(forecast.headroom)),
        forecast.perTurn !== null && row(p.perTurn, `~${formatTokens(forecast.perTurn)}`),
        forecast.turnsLeft !== null
          ? row(p.turnsLeft, `~${forecast.turnsLeft}`, { color: turnsColor, isStrong: true })
          : row(p.turnsLeft, p.unmeasured, { isDim: true }),
        <Text mono dimColor wrap="wrap">
          {forecast.turnsLeft === null ? p.paceNote : ''}
          {forecast.isAutoCompactEnabled ? p.endAuto : p.endManual}
        </Text>,
      ])}

      {card('mcp', p.mcpTitle, p.loaded(formatTokens(ownLoaded)), () => [
        columns(),
        !hasOwn && summary.idle.length === 0 && (
          <Text mono dimColor>
            {p.noServers}
          </Text>
        ),
        ...servers.map(server =>
          row(server.calls > 0 ? `${server.label} ${server.calls}×` : server.label, formatTokens(server.loadedTokens), {
            mark: '●',
            color: VERDICT_COLOR[server.verdict],
            tag: t.verdict[server.verdict],
            history: historyCell(server.evidence),
          }),
        ),
        ...summary.missing.map(server => row(server.label, '?', { mark: '○', color: 'error', tag: t.noTools })),
        !options.isDetailed && summary.idle.length > 0 && (
          <Text mono dimColor wrap="wrap">
            {p.idle(summary.idle.map(server => server.label).join(', '))}
          </Text>
        ),
        hasOwn && dashes(),
        summary.host.servers > 0 &&
          row(p.host(summary.host.servers), formatTokens(summary.host.loadedTokens), {
            isDim: true,
            color: VERDICT_COLOR.info,
            tag: t.verdict.info,
          }),
        ...hostServers.map(server =>
          row(`  ${server.label}`, formatTokens(server.loadedTokens), { isDim: true, tag: `${server.calls}×` }),
        ),
        row(p.deferred(summary.deferred.servers), formatTokens(summary.deferred.tokens), {
          isDim: true,
          tag: '',
        }),
      ])}

      {card('skills', p.skillsTitle, formatTokens(totals.skills), () => [
        columns(),
        ...skillRows.map(group =>
          row(group.skills > 1 ? `${group.label} (${group.skills})` : group.label, formatTokens(group.tokens), {
            mark: '●',
            color: VERDICT_COLOR[group.verdict],
            tag: t.verdict[group.verdict],
            history: FIXED_VERDICTS.has(group.verdict) && group.evidence.usedSessions === 0 ? '' : historyCell(group.evidence),
          }),
        ),
        otherSkills.length > 0 &&
          row(p.more(otherSkills.length), formatTokens(otherSkills.reduce((sum, group) => sum + group.tokens, 0)), {
            isDim: true,
            tag: '',
          }),
      ])}

      {card('actions', p.actionsTitle, actionsMeta, () => [
        !hasActions && (
          <Text mono dimColor wrap="wrap">
            {noActionsText(report)}
          </Text>
        ),
        ...summary.actions.map(item => (
          <Text mono wrap="wrap">
            <Text mono bold color="warning">
              −{formatTokens(item.saving)}{' '}
            </Text>
            {item.action}
          </Text>
        )),
        ...heavy.map(file => (
          <Text mono wrap="wrap">
            <Text mono bold color="warning">
              {formatTokens(file.tokens)}{' '}
            </Text>
            {p.trim(file.path)}
          </Text>
        )),
      ])}

      <Box flexDirection="column" paddingX={2} width={width + 4}>
        <Text mono dimColor wrap="wrap">
          {p.history(report.history.sessions)}
        </Text>
        <Text mono dimColor wrap="wrap">
          {p.credit}
        </Text>
      </Box>
    </Box>
  )
}
