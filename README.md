# Context Diet

A Claude Code mod that audits the **context cost** of a session: which MCP servers, skills, agents and memory files are active, how much each one weighs on every request, how much of it you really use, and what is worth removing.

> **Status:** v1.5.0, tested with Claude Code 2.1.325.

<details>
<summary><b>🇪🇸 Leer en español</b></summary>

<br>

Mod de Claude Code que audita el **costo de contexto** de una sesión: qué MCPs, skills, agentes y archivos de memoria están activos, cuánto pesa cada uno en cada request, cuánto se usa de verdad y qué conviene quitar.

### Problema

El contexto no se gasta solo en la conversación. Antes del primer mensaje ya hay decenas de miles de tokens ocupados por schemas de tools, listados de skills, agentes y memoria. Ese costo es fijo, se paga en cada request y casi nunca se mide.

### Qué hace

```text
/diet                 el reporte de la sesión (resumen)
/diet --all           con cada server, skill, agente y archivo
/diet --json          el reporte como JSON
/diet panel           panel en vivo junto al chat
/diet status on|off   avisos sobre el prompt (apagados por defecto)
/diet reset           borra el historial entre sesiones
/diet help            los comandos y cómo leer los veredictos
```

- **Tablero:** `/diet` dibuja el reporte en recuadros de color, uno por tema (fijo, lo que queda, MCP, skills, acciones), en monoespaciado y con filas de puntos guía. En el panel cada cabecera pliega su recuadro (teclas `1` a `5`); ACCIONES empieza plegado.
- **Costo real:** usa el mismo desglose que `/context`, por server, skill, agente y archivo.
- **Cargado vs diferido:** distingue lo que ocupa la ventana de lo que espera tras ToolSearch y cuesta 0.
- **Lo tuyo primero:** los servers que aporta la app o un plugin van agregados en una línea; no se quitan desde tu config y no se juzgan.
- **Uso real:** llamadas y errores por server, cargas por skill, usos por agente.
- **Historial:** recuerda 30 días de sesiones, así que un veredicto no depende de una sola.
- **Veredicto:** `USADO`, `OCASIONAL`, `CANDIDATO`, `OBSERVAR`, `FIJO`. Solo es candidato lo que no se usó en sesiones de 3 o más días distintos; cuentan las sesiones de 3 turnos o más, así que varias sesiones cortas en un rato no bastan.
- **Acción asistida:** da el comando exacto y el ahorro por request. Nunca desactiva nada solo.
- **Tu dieta:** compara el fijo por request de ahora con el de la sesión más antigua del historial, para ver si quitar cosas sirvió: `Hace 7 días: 65k → 48k, −17k (−26%)`.
- **Banda por demanda:** apagada por defecto. Con `/diet status on`, una fila sobre el prompt avisa cuando hay candidatos o la compactación está a 10 turnos o menos; se cierra con su × o con `/diet status off`.

El texto que queda en el transcript es un resumen corto:

```text
FIJO 33.7k por request · 13% de lo usado
  en uso      254.3k / 1M (25%)
  dieta       Hace 7 días: 41.7k → 33.7k, −8k (−19%)

TUS SERVIDORES MCP (3)
  CANDIDATO firecrawl [user] · 8k cargados (5/32 tools) · 18k diferidos · 0 llamadas · usado en 0/4 sesiones
  sin costo ni uso: brave-search (diferidos, 0 por request)

APP DE CLAUDE Y PLUGINS · 17 servers · 14.6k cargados · fijo, no se quita desde tu config
DIFERIDO · 20 servers · 109.3k tras ToolSearch · 0 por request

ACCIONES
  claude mcp remove -s user firecrawl   # −8k
```

El mod no registra tools, skills ni secciones de prompt: medir tokens no debe agregar tokens.

### Idioma

Los textos del reporte, el panel y la ayuda están en inglés y en español. El idioma es la opción `language` del plugin (`en` o `es`); viene en inglés. Para verlo en español, cámbialo desde `/config` o en `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "context-diet": { "options": { "language": "es" } } } }
```

### Instalación

En Claude Code:

```text
/plugin install context-diet --marketplace fugazi/context-diet
```

Desde la terminal:

```bash
claude plugin install context-diet --marketplace fugazi/context-diet
```

### Privacidad

Todo queda en la máquina. De los archivos de config solo se leen los nombres de los servers MCP: nunca `env`, `headers` ni argumentos. El historial guarda nombres y contadores.

La sección de desarrollo y la documentación están más abajo, en inglés.

</details>

## The problem

Context is not spent on the conversation alone. Before your first message, tens of thousands of tokens are already taken by tool schemas, skill listings, agents and memory. That cost is fixed, it is paid on every request, and it is almost never measured.

## What it does

```text
/diet                 the session report (summary)
/diet --all           with every server, skill, agent and file
/diet --json          the report as JSON
/diet panel           a live panel beside the chat
/diet status on|off   notices above the prompt (off by default)
/diet reset           clears the history between sessions
/diet help            the commands and how to read the verdicts
```

- **Dashboard:** `/diet` draws the report as colored cards, one per topic (fixed, what is left, MCP, skills, actions), in monospace with dot-leader rows. In the panel each header folds its card (keys `1` to `5`); ACTIONS starts folded.
- **Real cost:** it uses the same breakdown as `/context`, per server, skill, agent and file.
- **Loaded vs deferred:** it tells apart what sits in the window from what waits behind ToolSearch and costs 0.
- **Yours first:** servers that the app or a plugin brings are summed on one line; they cannot be removed from your config and are not judged.
- **Real use:** calls and errors per server, loads per skill, uses per agent.
- **History:** it remembers 30 days of sessions, so a verdict never rests on a single one.
- **Verdict:** `USED`, `OCCASIONAL`, `CANDIDATE`, `WATCH`, `FIXED`. Something is a candidate only when it went unused in sessions on 3 or more distinct days; only sessions of 3 or more turns count, so a few short sessions in a row are not enough.
- **Assisted action:** it gives the exact command and the saving per request. It never turns anything off by itself.
- **Your diet:** it compares the fixed cost per request now with that of the oldest session in the history, so you can see whether removing things paid off: `7 days ago: 65k → 48k, −17k (−26%)`.
- **Band on demand:** off by default. With `/diet status on`, a row above the prompt tells you when there are candidates or compaction is 10 turns away or less; close it with its × or with `/diet status off`.

The text left in the transcript is a short summary:

```text
FIXED 33.7k per request · 13% of what is in use
  in use    254.3k / 1M (25%)
  diet      7 days ago: 41.7k → 33.7k, −8k (−19%)

YOUR MCP SERVERS (3)
  CANDIDATE firecrawl [user] · 8k loaded (5/32 tools) · 18k deferred · 0 calls · used in 0/4 sessions
  no cost and no use: brave-search (deferred, 0 per request)

CLAUDE APP AND PLUGINS · 17 servers · 14.6k loaded · fixed, not removable from your config
DEFERRED · 20 servers · 109.3k behind ToolSearch · 0 per request

ACTIONS
  claude mcp remove -s user firecrawl   # −8k
```

The mod registers no tools, skills or prompt sections: measuring tokens must not add tokens.

## Language

The report, the panel and the help come in English and Spanish. The language is the plugin's `language` option (`en` or `es`), English by default. Change it from `/config`, or in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "context-diet": { "options": { "language": "es" } } } }
```

## Install

In Claude Code:

```text
/plugin install context-diet --marketplace fugazi/context-diet
```

From the terminal:

```bash
claude plugin install context-diet --marketplace fugazi/context-diet
```

Development mode, from the repository root:

```bash
claude --plugin-dir .
```

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
claude --plugin-dir . -p "/diet"
```

Tests run against the real engine with `claude plugin test`. Once the mod has loaded in an interactive session, the engine leaves the API types in `.claude-plugin/types/`; from then on `claude plugin validate .` type-checks too.

```text
context-diet/
├── .claude-plugin/       plugin and marketplace manifests, icon
├── hooks/
│   ├── context-diet.tsx  hooks, I/O and panel
│   └── lib/              report and verdicts, text, drawn dashboard, strings
├── types/index.d.ts      type contract
├── tests/                tests (`claude plugin test`)
├── docs/                 spec and spike findings
├── spike/                the minimal plugin from the first spike
└── ROADMAP.md
```

## Privacy

Everything stays on your machine. From the config files only the names of the MCP servers are read: never `env`, `headers` or arguments. The history stores names and counters.

## Documentation

These documents are in Spanish.

- [ROADMAP.md](ROADMAP.md): what is done and what is pending.
- [docs/spec.md](docs/spec.md): design, data sources and verdict rules.
- [docs/spike-mods-api.md](docs/spike-mods-api.md): findings about the mods API.
- [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview)

---

## 🏠 Author

- Name: `Douglas Urrea Ocampo`
- Job: `SDET - Software Developer Engineer in Test`
- Country: `Colombia`
- City: `Medellin`
- E-mail: `info@douglasfugazi.co`
- LinkedIn: [https://www.linkedin.com/in/douglasfugazi](https://www.linkedin.com/in/douglasfugazi)
- Contact: [https://douglasfugazi.co](https://douglasfugazi.co)
- Test automation skills & agents: [https://github.com/fugazi/test-automation-skills-agents](https://github.com/fugazi/test-automation-skills-agents)

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

<p align="center">Built with 💖 by Douglas Urrea Ocampo for the Claude Code community.</p>
