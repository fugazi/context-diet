// El reporte dibujado como una hoja de tarifas: la cifra que se paga en cada
// request en un recuadro doble, y debajo de qué está hecha y qué se puede
// quitar, en filas con puntos guía. Un mismo árbol para cada superficie.
import type { DietReport, DietVerdict } from '../../types'
import { VERDICT_LABEL, formatTokens, noActionsText, summarize } from './render'

/** La tabla de elementos de la superficie, de `$.ui.resolve(e)`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Kit = { Box: any; Text: any }

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

/** Ancho de la columna de veredicto: el del más largo. */
const TAG_CELLS = Math.max(...Object.values(VERDICT_LABEL).map(text => text.length))

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

const percent = (share: number) => `${Math.round(share * 100)}%`

type RowOptions = {
  /** Color del punto y del veredicto. */
  color?: string
  /** El punto de estado delante del nombre. */
  mark?: string
  /** El veredicto, en su columna a la derecha. */
  tag?: string
  isDim?: boolean
  isStrong?: boolean
}

export function label(kit: Kit, report: DietReport, options: { width: number; isDetailed?: boolean }) {
  const { Box, Text } = kit
  const width = options.width
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
    const tail = opts.tag === undefined ? 0 : TAG_CELLS + 2
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
          <Text mono color={opts.color}>
            {'  '}
            {opts.tag.padStart(TAG_CELLS)}
          </Text>
        )}
      </Text>
    )
  }

  /** El título de un recuadro, con su total a la derecha. */
  const head = (title: string, meta = '') => (
    <Box flexDirection="row" justifyContent="space-between" width={width}>
      <Text mono bold>
        {title}
      </Text>
      <Text mono dimColor>
        {meta}
      </Text>
    </Box>
  )

  const parts = options.isDetailed ? summary.composition : summary.composition.slice(0, SUMMARY_PARTS)
  const otherParts = summary.composition.slice(parts.length)
  const servers = options.isDetailed ? [...summary.shown, ...summary.idle] : summary.shown
  const hostServers = options.isDetailed ? connected.filter(server => server.scope === 'host') : []
  const skillRows = options.isDetailed ? summary.skills : summary.skills.slice(0, SUMMARY_SKILLS)
  const otherSkills = summary.skills.slice(skillRows.length)
  const heavy = report.memory.filter(file => file.isHeavy)
  const hasOwn = servers.length > 0 || summary.missing.length > 0
  const turnsColor = forecast.turnsLeft !== null && forecast.turnsLeft <= 10 ? 'warning' : 'success'
  const ownLoaded = summary.shown.reduce((sum, server) => sum + server.loadedTokens, 0)

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" width={width + 4} paddingX={2}>
        <Text mono bold>
          Context Diet
        </Text>
        {row('MODELO EN USO', report.model || 'sin dato', { isDim: true })}
      </Box>

      <Box flexDirection="column" borderStyle="double" paddingX={1} width={width + 4}>
        <Text mono dimColor wrap="wrap">
          Lo que Claude carga antes de leer tu mensaje: tools, skills e instrucciones. Se vuelve a enviar en cada
          request.
        </Text>
        {dashes()}
        {row('Fijo por request', `~${formatTokens(totals.fixed)}`, { color: FIXED_COLOR, isStrong: true })}
        {row('Conversación', formatTokens(forecast.conversation), { color: CONVERSATION_COLOR, isStrong: true })}
        {row('Límite de contexto del modelo', formatTokens(report.window))}
        <Box flexDirection="row" width={width} height={1}>
          {fixedCells > 0 && <Box width={fixedCells} height={1} backgroundColor={FIXED_COLOR} />}
          {conversationCells > 0 && <Box width={conversationCells} height={1} backgroundColor={CONVERSATION_COLOR} />}
          {freeCells > 0 && <Box width={freeCells} height={1} backgroundColor="subtle" />}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" width={width}>
          <Text mono color={FIXED_COLOR}>
            ■ {percent(summary.share.fixed)} fijo
          </Text>
          <Text mono color={CONVERSATION_COLOR}>
            ■ {percent(summary.share.conversation)} conversación
          </Text>
          <Text mono dimColor>
            ■ {percent(summary.share.free)} libre
          </Text>
        </Box>
        {dashes()}
        <Text mono bold>
          De qué está hecho el fijo
        </Text>
        {parts.map(part => row(part.label, formatTokens(part.tokens)))}
        {otherParts.length > 0 &&
          row(`Otros (${otherParts.length})`, formatTokens(otherParts.reduce((sum, part) => sum + part.tokens, 0)), {
            isDim: true,
          })}
      </Box>

      <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1} width={width + 4}>
        {head('Cuánto te queda', forecast.isAutoCompactEnabled ? 'hasta compactar' : 'hasta llenar el contexto')}
        {dashes()}
        {row('Espacio libre', formatTokens(forecast.headroom))}
        {forecast.perTurn !== null && row('Gasto medio por turno', `~${formatTokens(forecast.perTurn)}`)}
        {forecast.turnsLeft !== null
          ? row('Turnos que te quedan', `~${forecast.turnsLeft}`, { color: turnsColor, isStrong: true })
          : row('Turnos que te quedan', 'sin medir', { isDim: true })}
        <Text mono dimColor wrap="wrap">
          {forecast.turnsLeft === null
            ? 'El ritmo se mide tras un par de turnos. '
            : ''}
          {forecast.isAutoCompactEnabled
            ? 'Al agotarse, Claude resume la conversación para seguir y se pierde detalle.'
            : 'Al agotarse, la conversación no puede continuar.'}
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1} width={width + 4}>
        {head('Tus servidores MCP', `${formatTokens(ownLoaded)} cargados`)}
        {dashes()}
        {!hasOwn && summary.idle.length === 0 && (
          <Text mono dimColor>
            Ninguno en tu config.
          </Text>
        )}
        {servers.map(server =>
          row(server.calls > 0 ? `${server.label} ${server.calls}×` : server.label, formatTokens(server.loadedTokens), {
            mark: '●',
            color: VERDICT_COLOR[server.verdict],
            tag: VERDICT_LABEL[server.verdict],
          }),
        )}
        {summary.missing.map(server => row(server.label, '?', { mark: '○', color: 'error', tag: 'SIN TOOLS' }))}
        {!options.isDetailed && summary.idle.length > 0 && (
          <Text mono dimColor wrap="wrap">
            Sin costo ni uso: {summary.idle.map(server => server.label).join(', ')}
          </Text>
        )}
        {hasOwn && dashes()}
        {summary.host.servers > 0 &&
          row(`App de Claude y plugins (${summary.host.servers})`, formatTokens(summary.host.loadedTokens), {
            isDim: true,
            color: VERDICT_COLOR.info,
            tag: VERDICT_LABEL.info,
          })}
        {hostServers.map(server =>
          row(`  ${server.label}`, formatTokens(server.loadedTokens), { isDim: true, tag: `${server.calls}×` }),
        )}
        {row(`Diferidos (${summary.deferred.servers}), 0 por request`, formatTokens(summary.deferred.tokens), {
          isDim: true,
          tag: '',
        })}
      </Box>

      <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1} width={width + 4}>
        {head('Skills', `${formatTokens(totals.skills)} en el listado`)}
        {dashes()}
        {skillRows.map(group =>
          row(group.skills > 1 ? `${group.label} (${group.skills})` : group.label, formatTokens(group.tokens), {
            mark: '●',
            color: VERDICT_COLOR[group.verdict],
            tag: VERDICT_LABEL[group.verdict],
          }),
        )}
        {otherSkills.length > 0 &&
          row(`  +${otherSkills.length} más`, formatTokens(otherSkills.reduce((sum, group) => sum + group.tokens, 0)), {
            isDim: true,
            tag: '',
          })}
      </Box>

      <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1} width={width + 4}>
        {head('Qué hacer', totals.potentialSaving > 0 ? `−${formatTokens(totals.potentialSaving)} por request` : '')}
        {dashes()}
        {summary.actions.length === 0 && heavy.length === 0 && (
          <Text mono dimColor wrap="wrap">
            {noActionsText(report)}
          </Text>
        )}
        {summary.actions.map(item => (
          <Text mono wrap="wrap">
            <Text mono bold color="warning">
              −{formatTokens(item.saving)}{' '}
            </Text>
            {item.action}
          </Text>
        ))}
        {heavy.map(file => (
          <Text mono wrap="wrap">
            <Text mono bold color="warning">
              {formatTokens(file.tokens)}{' '}
            </Text>
            recorta {file.path}
          </Text>
        ))}
      </Box>

      <Box paddingX={2} width={width + 4}>
        <Text mono dimColor size="caption" wrap="wrap">
          Estimado como en /context. Historial: {report.history.sessions} sesión(es). Nada se apaga solo.
          {options.isDetailed ? '' : ' Detalle: /diet --all.'}
        </Text>
      </Box>
    </Box>
  )
}
