# Context Diet

<p align="right"><a href="README.md">English</a> · <b>Español</b></p>

Mod de Claude Code que audita el **costo de contexto** de una sesión: qué MCPs, skills, agentes y archivos de memoria están activos, cuánto pesa cada uno en cada request, cuánto se usa de verdad y qué conviene quitar.

> **Estado:** v1.5.0, probado con Claude Code 2.1.325.

## El problema

El contexto no se gasta solo en la conversación. Antes del primer mensaje ya hay decenas de miles de tokens ocupados por schemas de tools, listados de skills, agentes y memoria. Ese costo es fijo, se paga en cada request y casi nunca se mide.

## Qué hace

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

## Idioma

Los textos del reporte, el panel y la ayuda están en inglés y en español. El idioma es la opción `language` del plugin (`en` o `es`); viene en inglés. Para verlo en español, cámbialo desde `/config` o en `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "context-diet": { "options": { "language": "es" } } } }
```

## Instalación

En Claude Code:

```text
/plugin install context-diet --marketplace fugazi/context-diet
```

Desde la terminal:

```bash
claude plugin install context-diet --marketplace fugazi/context-diet
```

Modo desarrollo, desde la raíz del repositorio:

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

Los tests corren contra el motor real con `claude plugin test`. Cuando el mod ya cargó en una sesión interactiva, el motor deja los tipos de la API en `.claude-plugin/types/`; desde entonces `claude plugin validate .` también revisa tipos.

```text
context-diet/
├── .claude-plugin/       manifiestos del plugin y del marketplace, ícono
├── hooks/
│   ├── context-diet.tsx  hooks, E/S y panel
│   └── lib/              reporte y veredictos, texto, tablero dibujado, textos
├── types/index.d.ts      contrato de tipos
├── tests/                tests (`claude plugin test`)
├── docs/                 spec y hallazgos del spike
├── spike/                el plugin mínimo del primer spike
└── ROADMAP.md
```

## Qué intercepta el mod

El mod solo observa. Ninguno de sus hooks cambia una llamada a una tool, el texto de una skill, un prompt ni un ajuste, y no registra tools, agentes ni secciones de prompt.

| Hook | Qué hace |
| --- | --- |
| `session.start` | Registra el comando `/diet` y recupera los contadores de esta sesión desde su registro guardado. Pasa el evento sin cambios. |
| `tool.call` | Deja correr la llamada y luego la cuenta si es de una tool MCP o un subagente. Lee el nombre de la tool y si falló; nunca sus argumentos ni su resultado. No deniega ni reescribe llamadas. |
| `skill.prompt` | Cuenta qué skill se cargó y pasa su texto sin cambios. |
| `turn.complete` | Cuenta el turno, mide el contexto y guarda el registro de la sesión en el historial. |
| `command.run` (solo `diet`) | Responde a `/diet` y sus argumentos. |
| `ui.render` | Dibuja lo suyo: la fila de `/diet` en el transcript, el panel y la fila opcional sobre el prompt. |

## Privacidad

Todo queda en tu máquina: el mod no hace peticiones de red ni envía nada a ningún sitio.

- **Archivos que lee:** `~/.claude.json` y el `.mcp.json` del proyecto, para saber dónde está configurado cada server MCP (user, project o local). De ellos toma solo los nombres de los servers, las claves de `mcpServers`. Nunca lee ni guarda `env`, `headers`, argumentos, tokens ni ningún otro valor.
- **Entorno:** lee `HOME`, solo para encontrar `~/.claude.json`.
- **Qué guarda:** un historial de nombres de servers y skills con sus contadores, en el almacén propio del plugin en tu máquina. `/diet reset` lo borra.

## Documentación

- [ROADMAP.md](ROADMAP.md): qué está hecho y qué falta.
- [docs/spec.md](docs/spec.md): diseño, fuentes de datos y reglas de veredicto.
- [docs/spike-mods-api.md](docs/spike-mods-api.md): hallazgos sobre la API de mods.
- [Mods de Claude Code](https://code.claude.com/docs/en/plugins/mods/overview)

---

## 🏠 Autor

- Nombre: `Douglas Urrea Ocampo`
- Cargo: `SDET - Software Developer Engineer in Test`
- País: `Colombia`
- Ciudad: `Medellín`
- E-mail: `info@douglasfugazi.co`
- LinkedIn: [https://www.linkedin.com/in/douglasfugazi](https://www.linkedin.com/in/douglasfugazi)
- Contacto: [https://douglasfugazi.co](https://douglasfugazi.co)
- Skills y agentes de automatización de pruebas: [https://github.com/fugazi/test-automation-skills-agents](https://github.com/fugazi/test-automation-skills-agents)

---

## 📄 Licencia

Este proyecto está bajo la **Licencia MIT**; ver el archivo [LICENSE](LICENSE) para más detalles.

---

<p align="center">Hecho con 💖 por Douglas Urrea Ocampo para la comunidad de Claude Code.</p>
