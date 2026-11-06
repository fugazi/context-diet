// Context Diet — MVP
// Audit MCP and skill context cost for the current Claude Code session.
// The mod registers a command, not a tool: measuring tokens should not add tokens.

const TOOL_OVERHEAD_TOKENS = 150;
const SKILL_OVERHEAD_TOKENS = 100;
const CANDIDATE_MIN_TOKENS = 1500;

const state = {
  toolDescriptions: {},
  toolCalls: {},
  skillUses: {}
};

function parseMcpTool(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
  const rest = name.slice(5);
  const index = rest.indexOf('__');
  if (index <= 0 || index >= rest.length - 2) return null;
  return { server: rest.slice(0, index), tool: rest.slice(index + 2) };
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function formatTokens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?';
  if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(value));
}

function firstNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const data = {};
  let currentKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      let value = keyMatch[2].trim();
      if (value === '>' || value === '|') value = '';
      data[currentKey] = value.replace(/^["']|["']$/g, '');
    } else if (currentKey && /^\s+/.test(rawLine)) {
      data[currentKey] = (data[currentKey] ? data[currentKey] + ' ' : '') + line.trim();
    }
  }
  return data;
}

async function getHome($) {
  try {
    const value = await $.env.get('HOME');
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && typeof value.value === 'string' && value.value.trim()) return value.value.trim();
  } catch {
    // Fall through to printenv.
  }
  try {
    const result = await $.process.run(['printenv', 'HOME']);
    if (result && result.exitCode === 0 && typeof result.stdout === 'string' && result.stdout.trim()) return result.stdout.trim();
  } catch {
    // No home directory available.
  }
  return null;
}

async function getUsage($) {
  try {
    const usage = await $.session.usage();
    const context = usage && typeof usage === 'object' && usage.context && typeof usage.context === 'object' ? usage.context : usage;
    const tokens = firstNumber(context && (context.tokens ?? context.used ?? context.inputTokens));
    const window = firstNumber(context && (context.window ?? context.limit ?? context.maxTokens));
    let percent = firstNumber(context && (context.percent ?? context.percentage));
    if (percent == null && tokens != null && window != null && window > 0) percent = Math.round((tokens / window) * 100);
    return { tokens, window, percent, raw: usage };
  } catch (error) {
    return { error: String(error) };
  }
}

async function readJson($, path) {
  try {
    const text = await $.fs.read(path);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function addServers(map, config, scope, source, cwd) {
  if (!config || typeof config !== 'object') return;
  const groups = [];
  if (config.mcpServers && typeof config.mcpServers === 'object') {
    groups.push({ servers: config.mcpServers, scope });
  }
  if (config.projects && typeof config.projects === 'object') {
    const keys = Object.keys(config.projects);
    const normalizedCwd = String(cwd || '').replace(/\/$/, '');
    const key = keys.find((candidate) => candidate === cwd || candidate.replace(/\/$/, '') === normalizedCwd);
    const project = key ? config.projects[key] : null;
    if (project && project.mcpServers && typeof project.mcpServers === 'object') {
      groups.push({ servers: project.mcpServers, scope: 'project' });
    }
  }
  const priority = { user: 1, project: 2, local: 3 };
  for (const group of groups) {
    for (const name of Object.keys(group.servers)) {
      const raw = group.servers[name];
      if (!raw || typeof raw !== 'object') continue;
      const next = {
        name,
        scope: group.scope,
        source,
        kind: raw.url ? (raw.type || 'http') : raw.command ? 'stdio' : (raw.type || 'unknown')
      };
      const current = map.get(name);
      if (!current || (priority[group.scope] || 0) >= (priority[current.scope] || 0)) {
        map.set(name, next);
      }
    }
  }
}

async function collectServers($, cwd, home) {
  const map = new Map();
  if (home) {
    addServers(map, await readJson($, `${home}/.claude.json`), 'user', '~/.claude.json', cwd);
    addServers(map, await readJson($, `${home}/.claude/settings.json`), 'user', '~/.claude/settings.json', cwd);
  }
  if (cwd) {
    addServers(map, await readJson($, `${cwd}/.mcp.json`), 'project', '.mcp.json', cwd);
    addServers(map, await readJson($, `${cwd}/.claude/settings.json`), 'project', '.claude/settings.json', cwd);
    addServers(map, await readJson($, `${cwd}/.claude/settings.local.json`), 'local', '.claude/settings.local.json', cwd);
  }
  return [...map.values()];
}

async function collectSkills($, cwd, home) {
  const map = new Map();
  const dirs = [];
  if (home) dirs.push({ dir: `${home}/.claude/skills`, source: 'user' });
  if (cwd) dirs.push({ dir: `${cwd}/.claude/skills`, source: 'project' });

  for (const item of dirs) {
    let entries = [];
    try {
      entries = await $.fs.list(item.dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryName = typeof entry === 'string' ? entry : entry && entry.name;
      const entryKind = typeof entry === 'string' ? null : entry && entry.kind;
      if (typeof entryName !== 'string') continue;
      const candidates = [];
      if (entryKind === 'file' || entryName.endsWith('.md')) candidates.push(`${item.dir}/${entryName}`);
      if (entryKind !== 'file') candidates.push(`${item.dir}/${entryName}/SKILL.md`);

      let text = null;
      let skillPath = null;
      for (const candidate of candidates) {
        try {
          text = await $.fs.read(candidate);
          skillPath = candidate;
          break;
        } catch {
          // Try the next shape.
        }
      }
      if (text == null || skillPath == null) continue;

      const frontmatter = parseFrontmatter(text);
      const name = typeof frontmatter.name === 'string' && frontmatter.name.trim() ? frontmatter.name.trim() : entryName.replace(/\.md$/, '');
      const current = map.get(name);
      const next = {
        name,
        source: item.source,
        path: skillPath,
        description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
        chars: text.length,
        tokens: estimateTokens(text) + SKILL_OVERHEAD_TOKENS
      };
      if (!current || (item.source === 'project' && current.source === 'user')) {
        map.set(name, next);
      }
    }
  }
  return [...map.values()];
}

async function buildReport($) {
  let cwd = '.';
  try {
    cwd = await $.session.cwd();
  } catch {
    // Keep the relative default.
  }
  const home = await getHome($);
  const usage = await getUsage($);
  const configured = await collectServers($, cwd, home);
  const skills = await collectSkills($, cwd, home);
  const toolEntries = Object.values(state.toolDescriptions);

  const serverMap = new Map();
  for (const server of configured) {
    serverMap.set(server.name, { ...server, tools: [], calls: 0, observed: false });
  }
  for (const tool of toolEntries) {
    let server = serverMap.get(tool.server);
    if (!server) {
      server = { name: tool.server || 'desconocido', scope: 'no identificado', source: 'mcp/plugin', kind: 'mcp', tools: [], calls: 0, observed: true };
      serverMap.set(server.name, server);
    }
    server.tools.push(tool);
    server.calls += tool.calls || 0;
    server.observed = true;
  }

  const servers = [...serverMap.values()].map((server) => ({
    name: server.name,
    scope: server.scope,
    source: server.source,
    kind: server.kind,
    tools: server.tools.length,
    observed: server.observed,
    schemaTokens: server.tools.reduce((sum, tool) => sum + (tool.tokens || 0), 0),
    calls: server.calls || 0
  })).sort((a, b) => b.schemaTokens - a.schemaTokens || a.name.localeCompare(b.name));

  const skillsOut = skills.map((skill) => {
    const use = state.skillUses[skill.name];
    return {
      ...skill,
      loads: use ? use.count : 0,
      tokensLoaded: use ? use.tokens : 0,
      lastUsedAt: use ? use.lastUsedAt : null
    };
  }).sort((a, b) => b.loads - a.loads || a.name.localeCompare(b.name));

  const totals = {
    servers: servers.length,
    observedServers: servers.filter((server) => server.observed).length,
    schemaTokens: servers.reduce((sum, server) => sum + server.schemaTokens, 0),
    mcpCalls: servers.reduce((sum, server) => sum + server.calls, 0),
    skills: skillsOut.length,
    usedSkills: skillsOut.filter((skill) => skill.loads > 0).length
  };
  const candidates = servers.filter((server) => server.observed && server.calls === 0 && server.schemaTokens >= CANDIDATE_MIN_TOKENS);
  const watch = servers.filter((server) => server.observed && server.calls === 0 && server.schemaTokens > 0 && server.schemaTokens < CANDIDATE_MIN_TOKENS);

  return { generatedAt: new Date().toISOString(), cwd, usage, servers, skills: skillsOut, totals, candidates, watch };
}

function removeCommand(server) {
  if (server.scope === 'project') return `claude mcp remove -s project ${server.name}`;
  if (server.scope === 'local') return `claude mcp remove -s local ${server.name}`;
  return `claude mcp remove ${server.name}`;
}

function renderReport(report) {
  const lines = [];
  lines.push(`Context Diet · ${report.generatedAt.slice(0, 19).replace('T', ' ')}`);
  lines.push(`cwd: ${report.cwd}`);
  lines.push('');
  lines.push('CONTEXTO');
  if (report.usage && report.usage.error) {
    lines.push(`  no disponible: ${report.usage.error}`);
  } else if (report.usage && report.usage.tokens != null) {
    const window = report.usage.window != null ? formatTokens(report.usage.window) : '?';
    const percent = report.usage.percent != null ? `${report.usage.percent}%` : '?';
    lines.push(`  ${formatTokens(report.usage.tokens)} / ${window} (${percent})`);
  } else {
    lines.push('  sin datos de uso todavía');
  }
  lines.push(`  overhead MCP observado: ~${formatTokens(report.totals.schemaTokens)} tokens (${report.totals.observedServers}/${report.totals.servers} servers)`);
  lines.push('');
  lines.push(`MCP (${report.totals.servers})`);
  if (!report.servers.length) {
    lines.push('  sin servidores configurados en user/project');
  } else {
    for (const server of report.servers) {
      const tools = server.observed ? `${server.tools} tools` : 'tools n/d';
      const cost = server.observed ? `~${formatTokens(server.schemaTokens)} tok` : '~? tok';
      lines.push(`  • ${server.name} [${server.scope}, ${server.kind}] · ${tools} · ${cost} · ${server.calls} calls`);
    }
  }
  lines.push('');
  lines.push(`SKILLS (${report.totals.usedSkills}/${report.totals.skills} usadas)`);
  if (!report.skills.length) {
    lines.push('  sin skills en user/project');
  } else {
    for (const skill of report.skills.slice(0, 8)) {
      lines.push(`  • ${skill.name} [${skill.source}] · ${skill.loads} cargas · ~${formatTokens(skill.tokens)} tok`);
    }
    if (report.skills.length > 8) lines.push(`  … ${report.skills.length - 8} más`);
  }
  lines.push('');
  lines.push('VEREDICTO');
  if (!report.candidates.length && !report.watch.length) lines.push('  sin candidatos claros; seguí observando');
  for (const server of report.candidates) {
    lines.push(`  CANDIDATO  ${server.name} — 0 llamadas, ~${formatTokens(server.schemaTokens)} tok fijos`);
  }
  for (const server of report.watch) {
    lines.push(`  OBSERVAR   ${server.name} — 0 llamadas, ~${formatTokens(server.schemaTokens)} tok fijos`);
  }
  for (const server of report.servers.filter((item) => item.calls > 0)) {
    lines.push(`  USADO      ${server.name} — ${server.calls} llamadas`);
  }
  if (report.candidates.length) {
    lines.push('');
    lines.push('ACCIONES');
    for (const server of report.candidates) {
      if (server.scope === 'no identificado') {
        lines.push(`  # ${server.name}: revisar el plugin que lo aporta`);
      } else {
        lines.push(`  ${removeCommand(server)}`);
      }
    }
  }
  lines.push('');
  lines.push('Nota: costo estimado por longitud de descripciones (chars/4 + 150 tok/tool). No es el conteo exacto de Anthropic.');
  return lines.join('\n');
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'diet',
        description: 'Audit MCP and skill context cost for this session',
        argumentHint: '[--json]',
        immediate: true
      });
    } catch (error) {
      try {
        await $.ui.log(`Context Diet: /diet no registrado: ${String(error)}`);
      } catch {
        // The command may already be registered after a hot reload.
      }
    }
    return next(e);
  });

  on('tool.describe', async ($, e, next) => {
    try {
      const name = typeof e.tool === 'string' ? e.tool : '';
      if (name.startsWith('mcp__')) {
        const parsed = parseMcpTool(name);
        if (parsed) {
          const description = typeof e.description === 'string' ? e.description : '';
          const previous = state.toolDescriptions[name] || { calls: 0 };
          state.toolDescriptions[name] = {
            ...previous,
            server: parsed.server,
            tool: parsed.tool,
            descriptionChars: description.length,
            tokens: estimateTokens(description) + TOOL_OVERHEAD_TOKENS,
            describedAt: new Date().toISOString()
          };
        }
      }
    } catch {
      // Never block a tool description.
    }
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    try {
      const name = typeof e.tool === 'string' ? e.tool : 'unknown';
      state.toolCalls[name] = (state.toolCalls[name] || 0) + 1;
      if (name.startsWith('mcp__')) {
        const parsed = parseMcpTool(name);
        if (parsed) {
          const previous = state.toolDescriptions[name] || { tokens: 0, calls: 0 };
          state.toolDescriptions[name] = {
            ...previous,
            server: parsed.server,
            tool: parsed.tool,
            calls: (previous.calls || 0) + 1,
            lastCallAt: new Date().toISOString()
          };
        }
      }
    } catch {
      // Never block a tool call.
    }
    return next(e);
  });

  on('skill.prompt', async ($, e, next) => {
    try {
      const skill = e.skill && typeof e.skill === 'object' ? e.skill : null;
      const rawName = skill ? (skill.name || skill.id) : e.skill;
      const name = typeof rawName === 'string' && rawName ? rawName : 'unknown';
      const text = typeof e.text === 'string' ? e.text : '';
      const previous = state.skillUses[name] || { count: 0, tokens: 0 };
      state.skillUses[name] = {
        count: (previous.count || 0) + 1,
        tokens: previous.tokens || (text ? estimateTokens(text) + SKILL_OVERHEAD_TOKENS : 0),
        lastUsedAt: new Date().toISOString()
      };
    } catch {
      // Skills remain optional.
    }
    return next(e);
  });

  on('command.run', { command: 'diet' }, async ($, e) => {
    const report = await buildReport($);
    const args = typeof e.args === 'string' ? e.args : '';
    if (args.includes('--json')) {
      return { text: JSON.stringify(report, null, 2) };
    }
    try {
      const percent = report.usage && report.usage.percent != null ? `${report.usage.percent}%` : '?%';
      await $.ui.status(`CD · ${percent} ctx · ${report.totals.servers} MCP · ${report.candidates.length} candidato(s)`);
    } catch {
      // The status line is a convenience, not a requirement.
    }
    return { text: renderReport(report) };
  });
}
