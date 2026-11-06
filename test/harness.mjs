import assert from 'node:assert/strict';
import { register } from '../hooks/context-diet.mjs';

const handlers = {};
const registeredCommands = [];
const statusLines = [];

function on(event, matcher, hook) {
  if (typeof matcher === 'function') {
    hook = matcher;
    matcher = null;
  }
  (handlers[event] ||= []).push({ matcher, hook });
}

const files = new Map([
  ['/home/u/.claude.json', JSON.stringify({
    mcpServers: {
      postgres: { command: 'postgres-mcp', args: ['--db', 'demo'] }
    },
    projects: {
      '/work': {
        mcpServers: {
          github: { command: 'github-mcp' }
        }
      }
    }
  })],
  ['/work/.mcp.json', JSON.stringify({
    mcpServers: {
      fs: { command: 'fs-mcp' }
    }
  })],
  ['/home/u/.claude/skills/ctx/SKILL.md', [
    '---',
    'name: ctx',
    'description: Test skill for the harness',
    '---',
    '',
    'Use this skill in the harness.'
  ].join('\n')]
]);

const fake$ = {
  session: {
    cwd: async () => '/work',
    usage: async () => ({ context: { tokens: 38100, window: 200000, percent: 19 } })
  },
  env: {
    get: async (name) => (name === 'HOME' ? '/home/u' : null)
  },
  process: {
    run: async () => ({ exitCode: 1, stdout: '', stderr: '' })
  },
  fs: {
    read: async (path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path);
    },
    list: async (path) => {
      if (path === '/home/u/.claude/skills') return [{ name: 'ctx', kind: 'directory', size: 0, isLink: false }];
      throw new Error(`ENOENT: ${path}`);
    },
    exists: async (path) => files.has(path),
    stat: async () => ({ size: 0 })
  },
  command: {
    register: async (command) => { registeredCommands.push(command); }
  },
  ui: {
    log: async () => {},
    status: async (line) => { statusLines.push(line); }
  }
};

async function run(event, payload, matcherCheck = () => true) {
  const entry = (handlers[event] || []).find((item) => matcherCheck(item.matcher));
  if (!entry) throw new Error(`No handler for ${event}`);
  return entry.hook(fake$, payload, async (value) => value);
}

register(on);

await run('session.start', {});
assert.equal(registeredCommands.length, 1);
assert.equal(registeredCommands[0].name, 'diet');
assert.equal(registeredCommands[0].immediate, true);

await run('tool.describe', { tool: 'mcp__postgres__query', description: 'x'.repeat(8000) });
await run('tool.describe', { tool: 'mcp__github__search', description: 'y'.repeat(800) });
await run('tool.call', { tool: 'mcp__github__search' });
await run('skill.prompt', { skill: { name: 'ctx' }, text: 'Use this skill in the harness.' });

const isDiet = (matcher) => !matcher || matcher.command === 'diet';

const text = (await run('command.run', { command: 'diet', args: '' }, isDiet)).text;
assert.match(text, /CONTEXTO/);
assert.match(text, /38\.1k \/ 200k \(19%\)/);
assert.match(text, /postgres/);
assert.match(text, /github/);
assert.match(text, /CANDIDATO\s+postgres/);
assert.match(text, /USADO\s+github/);
assert.match(text, /ctx \[user\] · 1 cargas/);
assert.equal(statusLines.length, 1);
assert.match(statusLines[0], /CD · 19% ctx · 3 MCP · 1 candidato/);

const json = (await run('command.run', { command: 'diet', args: '--json' }, isDiet)).text;
const report = JSON.parse(json);
assert.equal(report.totals.servers, 3);
assert.equal(report.totals.observedServers, 2);
assert.equal(report.candidates[0].name, 'postgres');
assert.equal(report.servers.find((server) => server.name === 'github').calls, 1);
assert.equal(report.skills.find((skill) => skill.name === 'ctx').loads, 1);

console.log('HARNESS OK');
