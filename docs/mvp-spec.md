# Context Diet — Spec técnica del MVP

**Versión:** 0.1.0  
**Fecha:** 2026-11-05  
**Estado:** implementación inicial; runtime pendiente de QA en una sesión logueada.

## Objetivo

Dar una respuesta accionable a tres preguntas dentro de una sesión de Claude Code:

1. ¿Qué MCPs y skills están activos?
2. ¿Cuánto pesan en el contexto y cuánto se usaron?
3. ¿Qué conviene desactivar primero?

El MVP es un **comando** (`/diet`), no un panel. No registra tools propias: el mod que mide tokens no debe agregar tokens.

## Flujo de usuario

```text
/diet          → reporte legible en el transcript
/diet --json   → mismo reporte en JSON para QA o automatización
```

El reporte incluye:

- contexto usado / ventana / porcentaje;
- MCPs configurados, con scope, transporte, tools observadas, costo estimado y llamadas;
- skills disponibles/ usadas, con cargas y costo estimado;
- veredicto: `USADO`, `OBSERVAR`, `CANDIDATO`;
- comandos exactos para desactivar los candidatos;
- nota de método: el costo es una estimación, no el conteo de Anthropic.

## Fuentes de datos

| Dato | Fuente | Nota |
|---|---|---|
| Contexto | `$.session.usage()` | tokens, ventana y porcentaje; breakdown si está disponible |
| MCPs configurados | `~/.claude.json`, `~/.claude/settings.json`, `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json` | se leen con `$.fs`; no se imprimen env/headers |
| Tools MCP | evento `tool.describe` | nombre `mcp__server__tool` y descripción; costo por longitud |
| Uso MCP | evento `tool.call` | conteo por server/tool; no distingue éxito/error en v0 |
| Skills disponibles | `~/.claude/skills`, `.claude/skills` | se lee `SKILL.md` y su frontmatter |
| Uso de skills | evento `skill.prompt` | nombre y texto cargado si está disponible |
| HOME | `$.env.get('HOME')` con fallback a `printenv HOME` | necesario para configs de usuario |

## Arquitectura

```text
.claude-plugin/plugin.json     manifiesto
hooks/hooks.json               apunta a un único módulo
hooks/context-diet.mjs         registro de hooks + lógica
docs/mvp-spec.md               esta spec
test/harness.mjs               prueba local con un `$` falso
```

Hooks registrados:

- `session.start`: registra el comando `/diet` con `immediate: true`.
- `tool.describe`: indexa tools MCP y estima tokens por descripción.
- `tool.call`: cuenta llamadas por server/tool.
- `skill.prompt`: cuenta cargas de skills y guarda el nombre.
- `command.run`: construye y devuelve el reporte.

Estado en memoria del módulo: descripciones, llamadas y skills usadas. Un hot reload lo reinicia; aceptable para el MVP.

## Estimación de costo

```text
tokens_tool   ≈ ceil(len(description) / 4) + 150
tokens_skill  ≈ ceil(len(SKILL.md) / 4) + 100
```

- El costo por server es la suma de sus tools observadas.
- Si una tool no fue descrita todavía, el server se muestra con `tools n/d` y `~? tok`.
- El total se etiqueta como **observado**; no pretende ser el conteo exacto de Anthropic.
- Umbral de candidato: `0 llamadas` y `>= 1500 tokens` observados.

## Veredicto

- `USADO`: tuvo al menos una llamada.
- `CANDIDATO`: 0 llamadas y costo observado >= umbral.
- `OBSERVAR`: 0 llamadas y costo observado por debajo del umbral.
- `n/d`: no se observaron tools; no se emite veredicto.

Nunca se desactiva nada automáticamente. El reporte solo genera el comando para que el usuario lo copie.

## Límites del MVP

- No hay panel interactivo.
- No hay historial multi-sesión.
- No se inventaría el inventario de MCPs aportados por plugins; si aparecen tools `mcp__*` sin config, se muestran como `no identificado`.
- El conteo de uso es de llamadas, no de éxito/error.
- El costo es una estimación por longitud, no un breakdown exacto.
- No se registran tools propias.

## Criterios de aceptación

- `claude plugin validate .` pasa sin errores.
- `claude --plugin-dir . plugin details context-diet` reporta `Always-on: ~0 tok`.
- `node test/harness.mjs` pasa y el reporte contiene MCPs, skills, contexto y veredicto.
- En una sesión real, `/diet` responde en menos de 2 segundos con 10 MCPs (objetivo, no bloqueante).
- En una sesión real, `/diet --json` produce JSON parseable.
- El reporte no imprime valores de `env` ni `headers`.

## QA pendiente

En una máquina con Claude Code logueado:

```bash
claude --plugin-dir .
/diet
/diet --json
```

Verificar:

1. Que los MCPs configurados aparezcan con su scope correcto.
2. Que las tools usadas tengan conteo y las no usadas queden como `CANDIDATO`/`OBSERVAR`.
3. Que las skills usadas coincidan con `skill.prompt`.
4. Que el porcentaje de contexto coincida con `/context`.
5. Que los comandos `claude mcp remove` generados sean válidos para el scope.

## Próximo paso después del MVP

- v1: panel, historial 30 días y `full vs deferred`.
- Calibrar el estimador con datos reales de `/context`.
- Añadir lectura de MCPs aportados por plugins.
