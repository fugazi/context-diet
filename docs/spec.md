# Context Diet — Spec técnica

**Versión:** 1.0.0 · **Fecha:** 2026-11-14 · **Claude Code:** 2.1.325+

## Objetivo

Responder, dentro de una sesión de Claude Code:

1. ¿Qué ocupa el contexto antes de que empiece la conversación?
2. ¿Cuánto de eso se usa de verdad, en esta sesión y en las anteriores?
3. ¿Qué conviene quitar primero, y con qué comando?

El mod registra un comando, un panel y una línea de estado. No registra tools, skills ni secciones de prompt: medir tokens no debe agregar tokens.

## Comandos

```text
/diet                 reporte en el transcript
/diet --json          el mismo reporte como JSON (tipo DietReport)
/diet panel           panel en vivo
/diet status on|off   línea de estado
/diet reset           borra el historial
```

## Fuentes de datos

| Dato | Fuente | Nota |
|---|---|---|
| Desglose del contexto | `$.session.usage({ breakdown: 'summary' })` | El de `/context`. Estimado local, sin requests. |
| Tokens por server | `breakdown.mcpTools` | `isLoaded` separa lo cargado de lo diferido. |
| Skills | `breakdown.skills.skillFrontmatter` | Costo = su línea del listado. |
| Agentes, memoria | `breakdown.agents`, `breakdown.memoryFiles` | |
| Umbral de compactación | `breakdown.autoCompactThreshold` | |
| Uso de MCP y subagentes | evento `tool.call` | Cuenta llamadas y errores (`isError`, `deny`). |
| Uso de skills | evento `skill.prompt` | Por nombre y por grupo (`plugin:<nombre>` o fuente). |
| Ritmo de la conversación | evento `turn.complete` | Tokens de contexto al cierre de cada turno principal. |
| Scope de un server | `~/.claude.json`, `.mcp.json` | Solo nombres. Sirve para armar el comando de borrado. |
| Historial | `$.store`, clave `history-1` | 30 días, 200 sesiones. |

## Arquitectura

```text
types/index.d.ts          contrato: tipos del reporte y claves de $.state
hooks/context-diet.tsx    registro de hooks, I/O con $, panel
hooks/lib/report.ts       lógica pura: reporte, veredictos, historial, pronóstico
hooks/lib/render.ts       reporte como texto y línea de estado
test/*.test.ts(x)         tests con `claude plugin test`
```

Estado:

- `$.state` `usage`: contadores de la sesión. Sobreviven a un hot reload.
- `$.state` `report`: último reporte. El panel lo lee al dibujar, así que cada escritura lo redibuja.
- `$.store` `history-1`: un registro por sesión con todo lo presente y sus usos.
- `$.store` `status-line`: `false` si la persona la apagó.

## Veredictos

Se aplican a servers MCP y a grupos de skills.

| Veredicto | Regla | Acción |
|---|---|---|
| `USADO` | Al menos una llamada en esta sesión. | — |
| `OCASIONAL` | Sin uso ahora, usado en alguna sesión del historial. | — |
| `CANDIDATO` | Sin uso en 3 o más sesiones en las que estuvo presente. | Comando para quitarlo. |
| `OBSERVAR` | Sin uso, pero con menos de 3 sesiones de evidencia. | — |
| `FIJO` | Skills integradas, sincronizadas o de la organización. | — |

Una sesión cuenta como evidencia solo si completó al menos un turno principal. Un server configurado que no aportó tools no estuvo presente y no se juzga.

El ahorro de un candidato es lo que tiene cargado ahora: un server 100 % diferido ahorra 0 por request aunque sus schemas sumen miles de tokens.

Acciones generadas:

- Server en config: `claude mcp remove -s <user|project|local> <nombre>`.
- Conector de claude.ai: desconectarlo en `/mcp` o en claude.ai.
- Skills de un plugin: `claude plugin disable <plugin>` (tras revisar `claude plugin details`).
- Skill propia: mover su carpeta fuera de `skills/`.

## Pronóstico

- **Fijo** = filas `used` del desglose menos la de mensajes.
- **Margen** = umbral de auto-compactación (o la ventana, si está apagada) menos lo usado.
- **Ritmo** = media de los incrementos positivos entre las últimas muestras por turno. Un salto negativo es una compactación y se descarta.
- **Turnos restantes** = margen / ritmo.

## Límites conocidos

- Los tokens son los estimados de `/context` en modo `summary`, no un conteo exacto.
- La fila de mensajes y la de instrucciones MCP se reconocen por nombre; si el motor las renombra, la conversación contará como fijo.
- Un `/diet` lanzado justo al abrir la sesión puede no ver servers que aún están conectando.
- El historial es global, no por proyecto.
- Los servers que aporta un plugin se muestran con scope `unknown`.

## Verificación

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir . -p "/diet"
```

Con los tipos que el motor deja en `.claude-plugin/types/` al cargar el mod en una sesión interactiva, `tsc -p .` lo type-checkea.
