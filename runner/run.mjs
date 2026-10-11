#!/usr/bin/env node
// Verified runner: plays one Cube Arena run with an official command-line
// agent, with its tools locked to the label. Runs land on the Verified board
// because the operator token rides along as an MCP header.
//
//   node --env-file=.env.local runner/run.mjs --model claude-opus-5-5 --label "Claude Opus 5.5" \
//     [--size 3] [--mode interactive|one_shot] [--challenge ladder|scramble] [--effort high] \
//     [--url https://cube.krnl.studio/mcp] [--max-minutes 90]
//
// Only "model_only" is supported: the agent gets the cube tools and nothing
// else (no shell, no files, no web). Code and solver runs need a sandbox and
// are not offered on the Verified board yet.
//
// Needs CUBE_OPERATOR_TOKEN. The full transcript goes to runner/out/ (gitignored).

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    model: { type: 'string' },
    label: { type: 'string' },
    size: { type: 'string', default: '3' },
    mode: { type: 'string', default: 'interactive' },
    challenge: { type: 'string', default: 'ladder' },
    effort: { type: 'string' },
    url: { type: 'string', default: 'https://cube.krnl.studio/mcp' },
    name: { type: 'string', default: 'Cube Arena' },
    'max-minutes': { type: 'string', default: '90' },
    probe: { type: 'boolean', default: false },
  },
});

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) fail('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
if (!opt.model || !opt.label) fail('--model (the CLI model id) and --label (the name shown on the board) are required');
if (!['2', '3', '4', '5'].includes(opt.size)) fail('--size must be 2, 3, 4 or 5');
if (!['interactive', 'one_shot'].includes(opt.mode)) fail('--mode must be interactive or one_shot');
if (!['ladder', 'scramble'].includes(opt.challenge)) fail('--challenge must be ladder or scramble');

const here = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = opt.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
mkdirSync(join(here, 'out'), { recursive: true });
const logPath = join(here, 'out', `${stamp}-${slug}-${opt.size}x${opt.size}-${opt.mode}-${opt.challenge}.jsonl`);

// An empty working directory, so no project files or instructions leak in.
const work = mkdtempSync(join(tmpdir(), 'cube-runner-'));
const config = join(work, 'mcp.json');
writeFileSync(
  config,
  JSON.stringify({
    mcpServers: {
      'cube-arena': {
        type: 'http',
        url: opt.url,
        headers: {
          Authorization: `Bearer ${token}`,
          'x-arena-model': opt.label,
          'x-arena-tool-use': 'model_only',
          'x-arena-name': opt.name,
        },
      },
    },
  }),
  { mode: 0o600 },
);

const SYSTEM =
  'You are taking part in Cube Arena, a benchmark where an AI solves a twisty cube puzzle from pictures. ' +
  'Your only tools are the cube-arena tools. Work everything out yourself from the images; there is nothing else to use.';

const prompt = opt.probe
  ? 'Call the get_rules tool once, then reply with one line: how many images it returned and the first sentence of its text.'
  : `Let's play Cube Arena. First call get_rules. Then call start_run with size ${opt.size}, mode "${opt.mode}", challenge "${opt.challenge}", ` +
    `tool_use "model_only", and any display_name and model_name (the server fills them in for this run). ` +
    `Solve each cube from the pictures only. Keep going until the run ends, then reply with your result in one line.`;

const args = [
  '-p',
  prompt,
  '--model',
  opt.model,
  '--system-prompt',
  SYSTEM,
  '--tools',
  '',
  '--strict-mcp-config',
  '--mcp-config',
  config,
  '--allowedTools',
  'mcp__cube-arena',
  '--output-format',
  'stream-json',
  '--verbose',
  '--no-session-persistence',
  // Only settings from the (empty) working directory: no CLAUDE.md, plugins or
  // hooks from this machine reach the model. (--safe-mode would also drop the
  // cube server.)
  '--setting-sources',
  'local',
];
if (opt.effort) args.push('--effort', opt.effort);

console.log(`${opt.label}: ${opt.size}×${opt.size} ${opt.mode} ${opt.challenge} → ${opt.url}`);
console.log(`transcript: ${logPath}`);

const log = createWriteStream(logPath);
const started = Date.now();
const child = spawn('claude', args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
const killer = setTimeout(() => {
  console.log(`stopping after ${opt['max-minutes']} minutes`);
  child.kill('SIGTERM');
}, Number(opt['max-minutes']) * 60_000);

let buf = '';
let calls = 0;
let result = null;
child.stdout.on('data', (chunk) => {
  log.write(chunk);
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    for (const part of ev.message?.content ?? []) {
      if (part.type === 'tool_use') {
        calls += 1;
        const input = JSON.stringify(part.input ?? {});
        console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${part.name.replace('mcp__cube-arena__', '')} ${input.slice(0, 120)}`);
      }
      if (part.type === 'tool_result') {
        const text = (Array.isArray(part.content) ? part.content : []).find((c) => c.type === 'text')?.text ?? '';
        const first = text.split('\n')[0];
        if (first) console.log(`      → ${first.slice(0, 140)}`);
      }
    }
    if (ev.type === 'result') result = ev;
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

child.on('close', (code) => {
  clearTimeout(killer);
  log.end();
  rmSync(work, { recursive: true, force: true });
  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`\nexit ${code} after ${mins} min, ${calls} tool calls`);
  if (result) {
    console.log(`final: ${String(result.result ?? '').slice(0, 400)}`);
    if (result.total_cost_usd !== undefined) console.log(`cost (API-equivalent): $${Number(result.total_cost_usd).toFixed(2)}`);
  }
});
