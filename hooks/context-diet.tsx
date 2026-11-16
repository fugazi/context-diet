// Context Diet
// Audita el costo de contexto de MCPs, skills, agentes y memoria de la sesión.
// Registra un comando, no una tool: medir tokens no debe agregar tokens.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DietCounter, DietHistory, DietReport, DietScope, DietUsage } from '../types'
import {
  EMPTY_HISTORY,
  EMPTY_USAGE,
  buildReport,
  parseMcpTool,
  restoreUsage,
  pruneHistory,
  sanitizeHistory,
  skillGroupKey,
} from './lib/report'
import { SECTIONS, label, labelWidth } from './lib/label'
import { formatTokens, renderReport, reportStamp, summarize } from './lib/render'

const PANE = 'context-diet'
const PANE_TITLE = 'Context Diet'
const HISTORY_KEY = 'history-1'
const BAND_KEY = 'band'
/** La ayuda, como markdown: la fila de `/diet help` la dibuja en tablas. */
const HELP = [
  '**Comandos del mod**',
  '',
  '| Comando | Qué hace |',
  '| --- | --- |',
  '| `/diet` | Imprime el reporte completo: contexto, MCP, skills, agentes, memoria y acciones. |',
  '| `/diet --all` | El reporte con el detalle de cada server, skill, agente y archivo de memoria. |',
  '| `/diet --json` | El mismo reporte como JSON. |',
  '| `/diet panel` | Abre un panel junto al chat que se actualiza solo; tiene un botón «Actualizar» (tecla `r`). |',
  '| `/diet status on` | Muestra la línea de estado (viene apagada). |',
  '| `/diet status off` | La oculta; la preferencia se recuerda entre sesiones. |',
  '| `/diet reset` | Borra el historial entre sesiones; los veredictos vuelven a `OBSERVAR`. |',
  '| `/diet help` | Lista estos comandos. |',
  '',
  'Todos se pueden lanzar mientras Claude está respondiendo, sin esperar a que termine el turno.',
  '',
  '**Cómo leer el reporte**',
  '',
  '| Veredicto | Significado |',
  '| --- | --- |',
  '| `USADO` | Se usó en esta sesión. |',
  '| `OCASIONAL` | No se usó ahora, pero sí en otras sesiones. Nunca se propone quitarlo. |',
  '| `CANDIDATO` | Sin uso en 3 o más sesiones. Trae el comando para quitarlo y el ahorro. |',
  '| `OBSERVAR` | Sin uso, pero todavía con poca evidencia. |',
  '| `FIJO` | Skills integradas o sincronizadas, que no puedes quitar. |',
  '| `SIN TOOLS` | Server configurado que no aportó tools (desconectado o aún conectando). |',
].join('\n')

// Cambia la etiqueta cuando cambie la forma: descarta lo que guardó una
// versión anterior, que sobrevive a un hot reload.
const usageAtom = atom({ plugin: 'context-diet', key: 'usage' } as const, EMPTY_USAGE, { shape: 'usage-1' })
const reportAtom = atom({ plugin: 'context-diet', key: 'report' } as const, null, { shape: 'report-2' })
const printedAtom = atom({ plugin: 'context-diet', key: 'printed' } as const, null, { shape: 'report-2' })
const bandAtom = atom({ plugin: 'context-diet', key: 'band' } as const, false)
// ACCIONES empieza plegado: lo abre quien quiera verlo.
const foldedAtom = atom({ plugin: 'context-diet', key: 'folded' } as const, ['actions'] as string[], {
  shape: 'folded-1',
})

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
async function collectScopes($: Engine, cwd: string, isFresh = false): Promise<Record<string, DietScope>> {
  if (!isFresh && scopesCache && scopesCache.cwd === cwd) return scopesCache.scopes
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

/** El historial guardado, o null si no se pudo leer (no es lo mismo que vacío). */
async function loadHistory($: Engine): Promise<DietHistory | null> {
  try {
    return sanitizeHistory(await $.store.get(HISTORY_KEY))
  } catch {
    return null
  }
}

/**
 * Mide, arma el reporte, lo publica en `$.state` y guarda el historial.
 * `isFresh` (lo pide una persona, no el cierre de un turno) relee los configs
 * de MCP, que pueden cambiar a mitad de sesión.
 */
async function refresh($: Engine, isFresh = false): Promise<DietReport> {
  let cwd = '.'
  try {
    cwd = await $.session.cwd()
  } catch {
    // Se queda el relativo.
  }
  const [usage, counters, stored, scopes, now] = await Promise.all([
    $.session.usage({ breakdown: 'summary' }),
    read($, usageAtom),
    loadHistory($),
    collectScopes($, cwd, isFresh),
    $.clock.now(),
  ])
  const built = buildReport({ usage, counters, history: stored ?? EMPTY_HISTORY, scopes, cwd, now })
  await update($, reportAtom, () => built.report)
  // Tras un reinicio los contadores vuelven de lo guardado: se siguen desde ahí.
  if (built.counters !== counters) await update($, usageAtom, live => restoreUsage(live, built.history.sessions[String(usage.startedAt)]))
  const id = String(usage.startedAt)
  const mine = built.history.sessions[id]
  // Una lectura fallida no es un historial vacío: escribir ahora lo borraría.
  if (mine && stored) {
    try {
      // Otra sesión pudo guardar mientras se medía: se relee y solo se pone lo propio.
      const latest = await loadHistory($)
      if (latest) await $.store.set(HISTORY_KEY, { sessions: { ...pruneHistory(latest, now).sessions, [id]: mine } })
    } catch {
      // Sin historial el reporte de la sesión sigue valiendo.
    }
  }
  return built.report
}

/** Enciende o apaga la banda, en esta sesión y en las siguientes. */
async function setBand($: Engine, isOn: boolean): Promise<void> {
  await update($, bandAtom, () => isOn)
  try {
    await $.store.set(BAND_KEY, isOn)
  } catch {
    // Sin store vale para esta sesión.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'diet',
        description: 'Audita el costo de contexto de MCPs, skills, agentes y memoria',
        argumentHint: '[--all | --json | panel | banda on|off | reset]',
        immediate: true,
      })
    } catch (error) {
      $.ui.log(`Context Diet: /diet no registrado: ${String(error)}`)
    }
    try {
      // Solo por demanda: sin un `/diet banda on` guardado, no hay banda.
      const isOn = (await $.store.get(BAND_KEY)) === true
      await update($, bandAtom, () => isOn)
    } catch {
      // Sin preferencia guardada, la banda queda apagada.
    }
    try {
      // Una sesión reanudada recupera sus contadores antes de la primera llamada.
      const [usage, history] = await Promise.all([$.session.usage(), loadHistory($)])
      const record = history?.sessions[String(usage.startedAt)]
      if (record) await update($, usageAtom, live => restoreUsage(live, record))
    } catch {
      // Sin esto se recuperan en la primera medición.
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
        await refresh($)
      } catch {
        // El turno termina igual.
      }
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
    const [word, wanted] = args.split(/\s+/)
    if (word === 'banda' || word === 'status') {
      if (wanted !== 'on' && wanted !== 'off') return { text: 'Uso: /diet banda on|off' }
      await setBand($, wanted === 'on')
      return {
        text:
          wanted === 'on'
            ? 'Context Diet: avisos sobre el prompt activados. Se cierran con la × o con /diet banda off.'
            : 'Context Diet: avisos sobre el prompt apagados.',
      }
    }
    const report = await refresh($, true)
    if (args === 'panel' || args === '--panel') {
      const { isPlaced } = await $.ui.open({ id: PANE, title: PANE_TITLE })
      return { text: isPlaced ? 'Context Diet: Panel visual abierto.' : renderReport(report) }
    }
    if (args === '--json') return { text: JSON.stringify(report, null, 2) }
    if (args && args !== '--all') return { text: `Argumento desconocido: "${e.args.trim()}"\n\n${HELP}` }
    // La fila se dibuja de este reporte, no del que se refresca en cada turno.
    await update($, printedAtom, () => report)
    return { text: renderReport(report, { isDetailed: args === '--all' }) }
  })

  // La fila de `/diet` en el transcript, como etiqueta. Solo la del último
  // reporte impreso: una fila anterior, o de otra sesión, queda como texto.
  on('ui.render', { component: 'CommandOutput', props: { command: 'diet' } }, async ($, e, next) => {
    // La ayuda (sola o tras un argumento desconocido) va como tablas.
    if (!e.props.isErrored && e.props.text.endsWith(HELP)) {
      const { Markdown } = $.ui.resolve(e)
      return <Markdown text={e.props.text} />
    }
    // `/diet --all` ya es markdown: la fila lo dibuja en tablas por sí sola.
    if (e.props.args.trim().toLowerCase() === '--all') return next(e)
    const report = await read($, printedAtom)
    // El texto puede llegar bajo el nombre del plugin: el sello se busca dentro.
    if (!report || e.props.isErrored || !e.props.text.includes(reportStamp(report))) return next(e)
    return label($.ui.resolve(e), report, { width: labelWidth(e.viewport?.columns) })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text, Button } = kit
    const [report, folded] = await Promise.all([read($, reportAtom), read($, foldedAtom)])
    const reload = <Button key="refresh" label="Actualizar" hotkey="r" onPress={() => void refresh($, true).catch(() => undefined)} />
    if (!report) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Sin medición todavía.</Text>
          {reload}
        </Box>
      )
    }
    if (e.props.placement === 'widget') {
      return <Text>{summarize(report).alert ?? `fijo ${formatTokens(report.totals.fixed)} por request`}</Text>
    }
    return (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        {label(kit, report, {
          width: labelWidth(e.props.bodyColumns),
          panel: {
            folded: folded.filter(id => (SECTIONS as readonly string[]).includes(id)),
            onFold: id =>
              void update($, foldedAtom, now => (now.includes(id) ? now.filter(one => one !== id) : [...now, id])),
          },
        })}
        {reload}
      </Box>
    )
  })

  // La banda sobre el prompt: solo si se pidió con `/diet banda on` y hay algo
  // que hacer. La × la apaga hasta que se vuelva a pedir.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [report, isOn] = await Promise.all([read($, reportAtom), read($, bandAtom)])
    const alert = report && isOn ? summarize(report).alert : null
    if (!alert || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text wrap="truncate-end">
          <Text color="warning">● diet </Text>
          {alert}
          <Text dimColor> · /diet</Text>
        </Text>
        <Button key="hide" label="×" plain dimColor role="dismiss" onPress={() => void setBand($, false)} />
      </Box>
    )
  })
}
