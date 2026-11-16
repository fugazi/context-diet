# Context Diet

<p align="right"><b>English</b> · <a href="README.es.md">Español</a></p>

A Claude Code mod that audits the **context cost** of a session: which MCP servers, skills, agents and memory files are active, how much each one weighs on every request, how much of it you really use, and what is worth removing.

> **Status:** v1.5.0, tested with Claude Code 2.1.325.

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

## What the mod hooks

The mod only observes. None of its hooks changes a tool call, a skill's text, a prompt or a setting, and it registers no tools, agents or prompt sections.

| Hook | What it does |
| --- | --- |
| `session.start` | Registers the `/diet` command and restores this session's counters from its saved record. Passes the event on unchanged. |
| `tool.call` | Lets the call run, then counts it when it is an MCP tool or a subagent. It reads the tool's name and whether it failed; never its arguments or its result. It does not deny or rewrite calls. |
| `skill.prompt` | Counts which skill was loaded and passes its text on unchanged. |
| `turn.complete` | Counts the turn, measures the context and saves the session's record to the history. |
| `command.run` (`diet` only) | Answers `/diet` and its arguments. |
| `ui.render` | Draws its own three things: the `/diet` row in the transcript, the panel, and the optional row above the prompt. |

## Privacy

Everything stays on your machine: the mod makes no network requests and sends nothing anywhere.

- **Files it reads:** `~/.claude.json` and the project's `.mcp.json`, to learn where each MCP server is configured (user, project or local). From them it takes only the server names, the keys of `mcpServers`. It never reads or keeps `env`, `headers`, arguments, tokens or any other value.
- **Environment:** it reads `HOME`, only to find `~/.claude.json`.
- **What it stores:** a history of server and skill names with their counters, in the plugin's own store on your machine. `/diet reset` clears it.

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
