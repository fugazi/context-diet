# Context Diet

Mod de Claude Code que audita el **costo de contexto** de una sesión: qué MCPs, skills, agentes y archivos de memoria están activos, cuánto pesa cada uno en cada request, cuánto se usa de verdad y qué conviene quitar.

> **Estado:** v1.1.0, probado con Claude Code 2.1.325. Repo privado de trabajo.

## Problema

El contexto no se gasta solo en la conversación. Antes del primer mensaje ya hay decenas de miles de tokens ocupados por schemas de tools, listados de skills, agentes y memoria. Ese costo es fijo, se paga en cada request y casi nunca se mide.

## Qué hace

```text
/diet                 la etiqueta de la sesión
/diet --all           con cada server, skill, agente y archivo
/diet --json          el reporte como JSON
/diet panel           panel en vivo junto al chat
/diet banda on|off    avisos sobre el prompt (apagados por defecto)
/diet reset           borra el historial entre sesiones
```

- **Etiqueta:** `/diet` dibuja el reporte como una etiqueta nutricional, con una barra fijo / conversación / libre y colores por veredicto.
- **Costo real:** usa el mismo desglose que `/context`, por server, skill, agente y archivo.
- **Cargado vs diferido:** distingue lo que ocupa la ventana de lo que espera tras ToolSearch y cuesta 0.
- **Lo tuyo primero:** los servers que aporta la app o un plugin van agregados en una línea; no se quitan desde tu config y no se juzgan.
- **Uso real:** llamadas y errores por server, cargas por skill, usos por agente.
- **Historial:** recuerda 30 días de sesiones, así que un veredicto no depende de una sola.
- **Veredicto:** `USADO`, `OCASIONAL`, `CANDIDATO`, `OBSERVAR`, `FIJO`. Solo es candidato lo que no se usó en 3 o más sesiones.
- **Acción asistida:** da el comando exacto y el ahorro por request. Nunca desactiva nada solo.
- **Banda por demanda:** apagada por defecto. Con `/diet banda on`, una fila sobre el prompt avisa cuando hay candidatos o la compactación está a 10 turnos o menos; se cierra con su × o con `/diet banda off`.

El texto que queda en el transcript es un resumen corto:

```text
FIJO 33.7k por request · 13% de lo usado
  en uso      254.3k / 1M (25%)

TUS SERVIDORES MCP (3)
  CANDIDATO firecrawl [user] · 8k cargados (5/32 tools) · 18k diferidos · 0 llamadas · usado en 0/4 sesiones
  sin costo ni uso: brave-search (diferidos, 0 por request)

APP DE CLAUDE Y PLUGINS · 17 servers · 14.6k cargados · fijo, no se quita desde tu config
DIFERIDO · 20 servers · 109.3k tras ToolSearch · 0 por request

ACCIONES
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

Los tests corren contra el motor real con `claude plugin test`. Tras cargar el mod una vez en una sesión interactiva, el motor deja los tipos de la API en `.claude-plugin/types/`; desde entonces `claude plugin validate .` también type-checkea.

```text
context-diet/
├── .claude-plugin/       manifiestos del plugin y del marketplace
├── hooks/
│   ├── context-diet.tsx  hooks, I/O y panel
│   └── lib/              reporte y veredictos, texto, etiqueta dibujada
├── types/index.d.ts      contrato de tipos
├── tests/                tests (`claude plugin test`)
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
