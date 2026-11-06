# Context Diet

Claude Code mod para auditar el **costo de contexto** de MCPs y skills en una sesión: qué está activo, cuánto pesa en cada request, cuánto se usa de verdad y qué conviene desactivar.

> **Estado:** MVP en desarrollo. Repo privado de trabajo.
> **Producto:** comando `/diet` + status line. El panel interactivo queda para v1.

## Problema

El contexto no se gasta solo en la conversación. Cada MCP suma definiciones de tools a cada request y cada skill suma metadata (y su contenido completo cuando se invoca). Ese costo es fijo, invisible y casi nunca se mide. El resultado: sesiones que se compactan antes de tiempo y decisiones de configuración tomadas a ciegas.

## Alcance del MVP

- **Inventario:** MCPs y skills activos en la sesión, con origen y scope.
- **Costo fijo estimado:** rango de tokens que cada server/skill suma por request.
- **Uso real:** llamadas por server/tool, invocaciones de skills, último uso y errores.
- **Contexto en vivo:** overhead fijo vs conversación y forecast de compactación.
- **Veredicto:** candidatos a desactivar con reglas visibles y números.
- **Acción asistida:** comando exacto para desactivar; nunca automático.

## No objetivos (por ahora)

- Panel interactivo (v1).
- Historial multi-sesión persistente (v1).
- Auto-desactivar MCPs o skills.
- Recomendaciones generadas por un modelo.
- Registrar un tool propio: el mod que mide tokens no debe agregar tokens.

## Estructura prevista

```text
context-diet/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   ├── hooks.json
│   └── context-diet.mjs
├── types/
│   └── index.d.ts
├── tests/
│   └── context-diet.test.ts
└── README.md
```

## Referencias

- [Claude Code mods — overview](https://code.claude.com/docs/en/plugins/mods/overview)
- [Mods API](https://code.claude.com/docs/en/plugins/mods/api)
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference)

## Estado del trabajo

- [x] Repo privado creado
- [x] Spike estático: estructura validada con Claude Code 2.1.318 (`plugin validate` OK)
- [ ] Spike runtime: requiere una sesión logueada (el gateway no tiene auth de Anthropic)
- [ ] Spec técnica del MVP
- [ ] Implementación de `/diet`
- [ ] Pruebas en una sesión real con MCPs y skills
