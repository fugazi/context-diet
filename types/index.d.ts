// Context Diet — contrato de tipos.
// Autocontenido (sin imports): lo leen el módulo de hooks, los tests y
// `claude plugin validate`, que exige que cada clave de `$.state` esté aquí.

/** Uso observado de un server, skill o agente en la sesión en curso. */
export type DietCounter = {
  calls: number
  errors: number
  /** `$.clock.now()` de la última llamada; 0 si nunca. */
  lastAt: number
}

/** Contadores de la sesión. Viven en `$.state`: sobreviven a un hot reload. */
export type DietUsage = {
  servers: Record<string, DietCounter>
  /** Skills por nombre, tal como lo trae `skill.prompt`. */
  skills: Record<string, DietCounter>
  /** Skills por grupo (`plugin:<nombre>`, `userSettings`, ...). */
  skillGroups: Record<string, DietCounter>
  agents: Record<string, DietCounter>
  /** Turnos del hilo principal completados. */
  turns: number
  /** Tokens de contexto al cierre de cada turno (últimos 20). */
  samples: number[]
}

/** Lo que se guarda de una sesión en `$.store` para el historial. */
export type DietSessionRecord = {
  startedAt: number
  lastAt: number
  turns: number
  /** Cada server presente en la sesión, usado o no. */
  servers: Record<string, { calls: number; loadedTokens: number }>
  /** Cada grupo de skills presente, con sus cargas. */
  skillGroups: Record<string, number>
  /** Cada skill individual de usuario/proyecto presente, con sus cargas. */
  skills: Record<string, number>
}

export type DietHistory = {
  /** Por id de sesión (`String(startedAt)`). */
  sessions: Record<string, DietSessionRecord>
}

/** Evidencia acumulada de un ítem a lo largo del historial. */
export type DietEvidence = {
  /** Sesiones (con al menos un turno) en las que estuvo presente. */
  sessions: number
  /** De esas, en cuántas se usó. */
  usedSessions: number
  calls: number
  lastUsedAt: number | null
}

/**
 * `used`: se usó en esta sesión. `occasional`: no ahora, sí en otras.
 * `candidate`: nunca usado con evidencia suficiente. `watch`: nunca usado,
 * pero aún con pocas sesiones. `info`: no hay nada que el usuario pueda quitar.
 */
export type DietVerdict = 'used' | 'occasional' | 'candidate' | 'watch' | 'info'

/**
 * De dónde viene un server. `user`, `project` y `local` están en un config
 * tuyo; `connector` es de claude.ai; `host` lo aporta la app o un plugin y no
 * se quita con `claude mcp remove`.
 */
export type DietScope = 'user' | 'project' | 'local' | 'connector' | 'host'

export type DietServer = {
  /** Como llega en los `tool.call` (`mcp__<name>__tool`). */
  name: string
  /** Nombre para mostrar. */
  label: string
  scope: DietScope
  tools: number
  loadedTools: number
  /** Schemas de todas sus tools. */
  totalTokens: number
  /** Lo que ocupa en la ventana ahora: el costo real por request. */
  loadedTokens: number
  /** Schemas tras ToolSearch: fuera de la ventana, 0 por request. */
  deferredTokens: number
  /** Configurado pero sin tools en la sesión (desconectado o fallido). */
  isConnected: boolean
  calls: number
  errors: number
  evidence: DietEvidence
  verdict: DietVerdict
  /** Tokens que se liberan por request al quitarlo. */
  saving: number
  action: string | null
}

export type DietSkillGroup = {
  key: string
  label: string
  source: string
  pluginName: string | null
  skills: number
  tokens: number
  loads: number
  evidence: DietEvidence
  verdict: DietVerdict
  saving: number
  action: string | null
}

export type DietAgent = {
  agentType: string
  source: string
  tokens: number
  calls: number
}

export type DietMemoryFile = {
  path: string
  type: string
  tokens: number
  isHeavy: boolean
}

export type DietForecast = {
  /** Tokens en uso según el desglose. */
  used: number
  /** Umbral de auto-compactación, o la ventana si está apagada. */
  threshold: number
  isAutoCompactEnabled: boolean
  headroom: number
  /** Overhead fijo: todo lo que no es conversación. */
  fixed: number
  conversation: number
  /** Crecimiento medio por turno; null sin muestras suficientes. */
  perTurn: number | null
  turnsLeft: number | null
}

export type DietCategory = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type DietReport = {
  generatedAt: number
  cwd: string
  model: string
  window: number
  /** Tokens del último request; ausente antes del primer turno. */
  tokens: number | null
  percent: number | null
  categories: DietCategory[]
  totals: {
    fixed: number
    mcpLoaded: number
    mcpDeferred: number
    mcpInstructions: number
    skills: number
    agents: number
    memory: number
    /** Suma del ahorro de todos los candidatos. */
    potentialSaving: number
    candidates: number
  }
  servers: DietServer[]
  skillGroups: DietSkillGroup[]
  agents: DietAgent[]
  memory: DietMemoryFile[]
  forecast: DietForecast
  history: { sessions: number; days: number; minSessions: number }
  turns: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-diet': {
      usage: Shaped<DietUsage>
      report: Shaped<DietReport | null>
      /** El último reporte que `/diet` imprimió: su fila se dibuja de aquí. */
      printed: Shaped<DietReport | null>
      /** Si la banda sobre el prompt puede mostrarse. */
      band: boolean
    }
  }
}
