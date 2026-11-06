# Spike: API de mods de Claude Code

**Fecha:** 2026-11-05  
**Claude Code:** 2.1.318 (instalado localmente en `.tools/`, gitignored)  
**Spike:** `spike/` en este repo.

## Estado

- `claude plugin validate ./spike` → **✔ Validation passed**.
- `claude plugin details --plugin-dir ./spike context-diet-spike` → funciona sin auth.
- Sesión real → **bloqueada**: `Not logged in · Please run /login` (el gateway no tiene auth de Anthropic).

## Hallazgos

1. **No hay reflexión sobre `$`.** El validador rechaza `Object.keys($)`, `Object.keys($.session)`, etc. `$` solo se usa como `$.noun.method(...)`; `on("<event>", hook)`. El mod debe usar métodos documentados, sin descubrimiento dinámico.
2. **`claude plugin details` sirve como referencia de costo.** Reporta el costo proyectado por plugin. Para este spike: `Always-on: ~0 tok` porque no registra tools ni skills. Es una buena línea base para el principio “el mod que mide tokens no debe agregar tokens”.
3. **Hooks detectados por `validate`:** `session.start`, `tool.call`, `skill.prompt`, `turn.complete`. `plugin details` muestra `Hooks (0)`; probablemente cuenta settings hooks, no mods.
4. **Superficie documentada relevante para el MVP:**
   - `$.session.cwd()`, `$.session.usage()` (contexto y límites del plan), `$.session.messages()`.
   - `$.fs.read/write/exists/stat/list`.
   - `$.mcp.call` solamente: no hay `list`/inventario de servidores.
   - `$.ui.log/status/toast`.
   - `$.process.run` permite ejecutar CLI, pero invocar `claude` dentro de una sesión es pesado.
5. **Eventos:** `Object.keys(e)` sí se puede inspeccionar; el spike vuelca las claves a `.context-diet-spike.json`.
6. **Skills:** el evento `skill.prompt` trae `e.skill` con nombre, fuente, plugin, path y frontmatter (según la doc).
7. **MCP:** los `tool.call` llegan como `mcp__server__tool`, así que se puede contar uso por server. El inventario y el costo por server requieren leer configs (`~/.claude.json`, `.mcp.json`, settings) o estimar desde schemas; la API no expone un breakdown por servidor.

## Bloqueante para cerrar el spike

Falta ejecutar una sesión real con auth de Anthropic. En una máquina logueada:

```bash
claude --plugin-dir ./spike
```

Hacer un turno y revisar `.context-diet-spike.json`. Ese archivo responde:

- forma exacta de `$.session.usage()` y `usage({ breakdown: true })`;
- claves reales de los eventos;
- qué trae `skill.prompt`;
- si el breakdown de contexto separa MCP tools del resto.

## Implicación para el MVP

El MVP se puede construir con la API documentada, pero el costo por servidor será **estimado** (configs + schemas + tokenizer), no un dato exacto de Anthropic. La estimación debe mostrarse como rango y con método visible. El veredicto y la acción copiable no dependen de esa precisión.
