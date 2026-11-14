# Context Diet

Mod de Claude Code que audita el **costo de contexto** de una sesión: qué MCPs, skills, agentes y archivos de memoria están activos, cuánto pesa cada uno en cada request, cuánto se usa de verdad y qué conviene quitar.

> **Estado:** v1.0.0, probado con Claude Code 2.1.325. Repo privado de trabajo.

## Problema

El contexto no se gasta solo en la conversación. Antes del primer mensaje ya hay decenas de miles de tokens ocupados por schemas de tools, listados de skills, agentes y memoria. Ese costo es fijo, se paga en cada request y casi nunca se mide.

## Qué hace

```text
/diet                 reporte en el transcript
/diet --json          el mismo reporte como JSON
/diet panel           panel en vivo junto al chat
/diet status on|off   línea de estado (activada por defecto)
/diet reset           borra el historial entre sesiones
```

- **Costo real:** usa el mismo desglose que `/context`, por server, skill, agente y archivo.
- **Cargado vs diferido:** distingue lo que ocupa la ventana de lo que espera tras ToolSearch y cuesta 0.
- **Uso real:** llamadas y errores por server, cargas por skill, usos por agente.
- **Historial:** recuerda 30 días de sesiones, así que un veredicto no depende de una sola.
- **Veredicto:** `USADO`, `OCASIONAL`, `CANDIDATO`, `OBSERVAR`. Solo es candidato lo que no se usó en 3 o más sesiones.
- **Acción asistida:** da el comando exacto y el ahorro por request. Nunca desactiva nada solo.
- **Pronóstico:** margen hasta la compactación y turnos restantes al ritmo actual.

Ejemplo:

```text
MCP (3) · 8.6k cargados · 30.5k diferidos (0 por request) · 1.8k en instrucciones
  CANDIDATO firecrawl [user] · 8k cargados (5/32 tools) · 18k diferidos · 0 llamadas · usado en 0/4 sesiones
  OCASIONAL brave-search [user] · 0 cargados (0/8 tools) · 11.2k diferidos · 0 llamadas · usado en 1/4 sesiones

ACCIONES
  ahorro potencial: 8k por request
  claude mcp remove -s user firecrawl   # −8k
```

El mod no registra tools, skills ni secciones de prompt: medir tokens no debe agregar tokens.

## Instalación

Marketplace (requiere acceso al repo privado):

```text
/plugin install context-diet --marketplace fugazi/context-diet
```

Desde la terminal:

```bash
claude plugin install context-diet --marketplace fugazi/context-diet
```

Modo desarrollo, desde la raíz del repo:

```bash
claude --plugin-dir .
```

## Desarrollo

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
claude --plugin-dir . -p "/diet"
```

Los tests corren contra el motor real con `claude plugin test`. Tras cargar el mod una vez en una sesión interactiva, el motor deja los tipos de la API en `.claude-plugin/types/` y `tsc -p .` lo type-checkea.

```text
context-diet/
├── .claude-plugin/       manifiestos del plugin y del marketplace
├── hooks/
│   ├── context-diet.tsx  hooks, I/O y panel
│   └── lib/              lógica pura: reporte, veredictos, render
├── types/index.d.ts      contrato de tipos
├── test/                 tests (`claude plugin test`)
├── docs/                 spec y hallazgos del spike
├── spike/                plugin mínimo del spike inicial
└── ROADMAP.md
```

## Privacidad

Todo queda en la máquina. De los archivos de config solo se leen los nombres de los servers MCP: nunca `env`, `headers` ni argumentos. El historial guarda nombres y contadores.

## Documentación

- [ROADMAP.md](ROADMAP.md): hecho y pendiente.
- [docs/spec.md](docs/spec.md): diseño, fuentes de datos y reglas de veredicto.
- [docs/spike-mods-api.md](docs/spike-mods-api.md): hallazgos sobre la API de mods.
- [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview)
