# Spike de la API de mods

Plugin mínimo para inspeccionar la API de mods de Claude Code antes de construir el MVP de Context Diet.

## Uso

Desde la raíz del repo, en una máquina con Claude Code logueado:

```bash
claude --plugin-dir ./spike
```

Hacé un turno y revisá `.context-diet-spike.json` en el cwd de la sesión.

## Qué registra

- `$.session.usage()` y `$.session.usage({ breakdown: true })`
- claves de los eventos `session.start`, `tool.call`, `skill.prompt`, `turn.complete`
- conteo de tool calls por nombre (incluye `mcp__server__tool`)
- payload de `skill.prompt` (`e.skill`)

## Validación estática

```bash
claude plugin validate ./spike
```

Debe pasar sin errores. El runtime requiere auth de Anthropic.
