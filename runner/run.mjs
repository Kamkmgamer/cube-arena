#!/usr/bin/env node
// Verified runner: plays one Cube Arena run with an official command-line
// agent, Claude Code or Codex, with its tools locked to the label. Runs land
// on the Verified board because the operator token rides along as an MCP header.
//
//   node --env-file=.env.local runner/run.mjs --model claude-opus-5-5 [--effort high] \
//     [--size 3] [--mode interactive|one_shot] [--challenge ladder|scramble] \
//     [--url https://cube.krnl.studio/mcp] [--max-minutes 90]
//   node --env-file=.env.local runner/run.mjs --model gpt-6-astra --effort xhigh
//
// The board name is worked out from the exact model id and effort
// ("Claude Opus 5.5 (high)", "GPT-6-Astra (xhigh)"), so it cannot be mistyped,
// and aliases like "opus" are refused. Claude runs also check that the model
// that answered is the one asked for.
//
// Only "model_only" is supported: the agent gets the cube tools and nothing
// else (no shell, files, code or web). Anything else showing up in the stream
// stops the run and hides it. Code and solver runs need a sandbox and are not
// offered on the Verified board yet.
//
// Codex runs use their own CODEX_HOME (default ~/.codex-bench, signed in once
// with `CODEX_HOME=~/.codex-bench codex login --device-auth`), so no
// AGENTS.md, config, skills or memories from this machine reach the model.
//
// Needs CUBE_OPERATOR_TOKEN. If the agent stops before the run is over (time
// limit, crash, or it just quits), the run is ended as a timeout. Transcripts
// go to runner/out/ (gitignored), with image data left out.

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CLAUDE_EFFORTS, agentFor, boardLabel, claudeName, codexEfforts, codexModels, codexName, effortFor } from './models.mjs';

const { values: opt } = parseArgs({
  options: {
    model: { type: 'string' },
    effort: { type: 'string', default: 'high' },
    size: { type: 'string', default: '3' },
    mode: { type: 'string', default: 'interactive' },
    challenge: { type: 'string', default: 'ladder' },
    url: { type: 'string', default: 'https://cube.krnl.studio/mcp' },
    name: { type: 'string', default: 'Cube Arena' },
    'max-minutes': { type: 'string', default: '90' },
    'codex-home': { type: 'string', default: join(homedir(), '.codex-bench') },
    probe: { type: 'boolean', default: false },
  },
});

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) fail('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
if (!opt.model) fail('--model is required: the full model id, e.g. claude-opus-5-5 or gpt-6-astra');
if (!['2', '3', '4', '5'].includes(opt.size)) fail('--size must be 2, 3, 4 or 5');
if (!['interactive', 'one_shot'].includes(opt.mode)) fail('--mode must be interactive or one_shot');
if (!['ladder', 'scramble'].includes(opt.challenge)) fail('--challenge must be ladder or scramble');

const agent = agentFor(opt.model);
let name = null;
if (agent === 'claude') {
  name = claudeName(opt.model);
  if (!CLAUDE_EFFORTS.includes(opt.effort)) fail(`--effort for Claude must be one of ${CLAUDE_EFFORTS.join(', ')}`);
} else if (agent === 'codex') {
  const models = codexModels(opt['codex-home']);
  name = codexName(opt.model, models);
  const efforts = codexEfforts(opt.model, models);
  if (efforts && !efforts.includes(opt.effort)) fail(`${opt.model} takes --effort ${efforts.join(', ')}`);
}
if (!name) fail(`Can't tell the exact model from "${opt.model}". Use a full model id (claude-opus-5-5, gpt-6-astra), not an alias.`);
const effort = effortFor(opt.model, opt.effort);
const label = boardLabel(name, effort);

const here = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(join(here, 'out'), { recursive: true });
const logPath = join(here, 'out', `${stamp}-${opt.model}-${effort ?? 'default'}-${opt.size}x${opt.size}-${opt.mode}-${opt.challenge}.jsonl`);

const SYSTEM =
  'You are taking part in Cube Arena, a benchmark where an AI solves a twisty cube puzzle from pictures. ' +
  'Your only tools are the cube-arena tools. Work everything out yourself from the images; there is nothing else to use.';

const prompt = opt.probe
  ? 'Call the get_rules tool once, then reply with one line: how many images it returned and the first sentence of its text.'
  : `Let's play Cube Arena. First call get_rules. Then call start_run with size ${opt.size}, mode "${opt.mode}", challenge "${opt.challenge}", ` +
    `tool_use "model_only", and any display_name and model_name (the server fills them in for this run). ` +
    `Solve each cube from the pictures only. Keep going until the run ends, then reply with your result in one line.`;

const headers = { 'x-arena-model': label, 'x-arena-tool-use': 'model_only', 'x-arena-name': opt.name };

// An empty working directory, so no project files or instructions leak in.
const work = mkdtempSync(join(tmpdir(), 'cube-runner-'));

function claudeCommand() {
  const config = join(work, 'mcp.json');
  writeFileSync(
    config,
    JSON.stringify({ mcpServers: { 'cube-arena': { type: 'http', url: opt.url, headers: { Authorization: `Bearer ${token}`, ...headers } } } }),
    { mode: 0o600 },
  );
  // --tools '' leaves no built-in tools; --setting-sources local reads settings
  // only from the (empty) working directory, so no CLAUDE.md, plugins or hooks
  // from this machine reach the model. (--safe-mode would also drop the cube server.)
  const args = ['-p', prompt, '--model', opt.model, '--system-prompt', SYSTEM, '--tools', ''];
  if (effort) args.push('--effort', effort);
  args.push('--strict-mcp-config', '--mcp-config', config, '--allowedTools', 'mcp__cube-arena');
  args.push('--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', 'local');
  return { cmd: 'claude', args, env: process.env };
}

// Everything Codex could use besides the cube server, switched off. With
// code_mode_host off, its JavaScript exec tool only returns an error, and the
// cube tools are called directly.
const CODEX_OFF = [
  'shell_tool', 'unified_exec', 'unified_exec_tty', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
  'multi_agent', 'plugins', 'code_mode_host', 'in_app_browser', 'hooks', 'view_image', 'tool_suggest', 'skill_search', 'goals', 'sleep_tool',
  'skill_mcp_dependency_install', 'workspace_dependencies',
];

function codexCommand() {
  const instructions = join(work, 'instructions.md');
  writeFileSync(instructions, `${SYSTEM}\n`);
  const toml = JSON.stringify; // a JSON string is a valid TOML basic string
  const table = `{${Object.entries(headers)
    .map(([k, v]) => `${toml(k)}=${toml(v)}`)
    .join(',')}}`;
  const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only'];
  args.push('-m', opt.model, '-c', `model_reasoning_effort=${toml(opt.effort)}`);
  for (const f of CODEX_OFF) args.push('--disable', f);
  args.push('-c', 'agents.enabled=false', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0');
  args.push('-c', `model_instructions_file=${toml(instructions)}`);
  args.push('-c', 'features.code_mode.direct_only_tool_namespaces=["mcp__cube_arena"]');
  args.push('-c', `mcp_servers.cube-arena.url=${toml(opt.url)}`);
  args.push('-c', 'mcp_servers.cube-arena.bearer_token_env_var="CUBE_OPERATOR_TOKEN"');
  args.push('-c', `mcp_servers.cube-arena.http_headers=${table}`);
  args.push(prompt);
  return { cmd: 'codex', args, env: { ...process.env, CODEX_HOME: opt['codex-home'] } };
}

const { cmd, args, env } = agent === 'claude' ? claudeCommand() : codexCommand();

console.log(`${label} [${opt.model}, ${agent}]: ${opt.size}×${opt.size} ${opt.mode} ${opt.challenge} → ${opt.url}`);
console.log(`transcript: ${logPath}`);

// Operator calls to the site, to end or hide this run.
const site = opt.url.replace(/\/mcp\/?$/, '');
async function admin(body) {
  const res = await fetch(`${site}/api/admin/runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.log(`  (operator call failed: ${res.status})`);
}

const log = createWriteStream(logPath);
const started = Date.now();
const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
const child = spawn(cmd, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });

let stopReason = null;
function stop(reason) {
  if (stopReason) return;
  stopReason = reason;
  console.log(`stopping: ${reason}`);
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
}
const killer = setTimeout(() => stop(`the runner's ${opt['max-minutes']}-minute limit`), Number(opt['max-minutes']) * 60_000);

let runId = null;
let runOver = false;
let last = null; // the latest reply's data block
let calls = 0;
let breach = null;
let final = null;

function seeReply(text) {
  const first = text.split('\n')[0];
  if (first) console.log(`      → ${first.slice(0, 140)}`);
  const json = text.slice(text.lastIndexOf('\n{') + 1);
  try {
    const data = JSON.parse(json);
    if (data.run_id) runId = data.run_id;
    if (data.run_status === 'finished') runOver = true;
    last = data;
  } catch {
    // not a game reply
  }
}

function seeCall(tool, input) {
  calls += 1;
  console.log(`  [${secs()}] ${tool} ${JSON.stringify(input ?? {}).slice(0, 120)}`);
}

function lockdown(what) {
  if (breach) return;
  breach = what;
  stop(`lockdown broken: ${what}`);
}

// Claude Code stream-json.
function onClaude(ev) {
  if (ev.type === 'system' && ev.subtype === 'init') {
    if (ev.model !== opt.model) lockdown(`asked for ${opt.model}, the CLI started ${ev.model}`);
    const extra = (ev.tools ?? []).filter((t) => !t.startsWith('mcp__cube-arena__'));
    if (extra.length) lockdown(`tools besides the cube: ${extra.join(', ')}`);
  }
  if (ev.type === 'assistant' && ev.message?.model && ev.message.model !== opt.model) lockdown(`${ev.message.model} answered, not ${opt.model}`);
  for (const part of ev.message?.content ?? []) {
    if (part.type === 'tool_use') {
      if (!part.name.startsWith('mcp__cube-arena__')) lockdown(`called ${part.name}`);
      seeCall(part.name.replace('mcp__cube-arena__', ''), part.input);
    }
    if (part.type === 'tool_result') seeReply((Array.isArray(part.content) ? part.content : []).find((c) => c.type === 'text')?.text ?? '');
  }
  if (ev.type === 'result') final = String(ev.result ?? '');
}

// Codex exec --json. Only these items are expected; a shell command, file
// change, web search or any other server's tool means the lockdown failed.
const CODEX_OK = new Set(['agent_message', 'reasoning', 'mcp_tool_call', 'error', 'todo_list']);
function onCodex(ev) {
  const item = ev.item;
  if (ev.type === 'item.started' || ev.type === 'item.completed') {
    if (!CODEX_OK.has(item.type)) return lockdown(`a ${item.type} item`);
    if (item.type === 'mcp_tool_call' && item.server !== 'cube-arena') return lockdown(`called ${item.server}.${item.tool}`);
  }
  if (ev.type === 'item.started' && item.type === 'mcp_tool_call') seeCall(item.tool, item.arguments);
  if (ev.type === 'item.completed') {
    if (item.type === 'mcp_tool_call') {
      if (item.error) console.log(`      → error: ${JSON.stringify(item.error).slice(0, 140)}`);
      seeReply((item.result?.content ?? []).find((c) => c.type === 'text')?.text ?? '');
    }
    if (item.type === 'agent_message') {
      final = item.text;
      console.log(`  [${secs()}] says: ${item.text.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  if (ev.type === 'turn.failed' || ev.type === 'error') console.log(`  [${secs()}] ${ev.type}: ${JSON.stringify(ev.error ?? ev.message).slice(0, 200)}`);
}

// Transcripts keep everything but the pictures, which the site can redraw.
const slim = (line) => line.replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, (m) => `"data":"<${m.length - 9} base64 chars>"`);

let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    log.write(`${slim(line)}\n`);
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (agent === 'claude') onClaude(ev);
    else onCodex(ev);
  }
});
child.stderr.on('data', (chunk) => {
  // Codex logs its disabled code-mode host on every start; that is expected.
  const text = String(chunk)
    .split('\n')
    .filter((l) => l && !/code-mode host is disabled|Reading additional input from stdin/.test(l))
    .join('\n');
  if (text) process.stderr.write(`${text}\n`);
});

child.on('close', async (code) => {
  clearTimeout(killer);
  log.end();
  rmSync(work, { recursive: true, force: true });
  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`\nexit ${code} after ${mins} min, ${calls} tool calls`);
  const stopped = runId && !runOver;
  if (stopped) {
    const why = stopReason ? `stopped by ${stopReason}` : 'the agent stopped before the run was over';
    await admin({ id: runId, stop: true, reason: why });
    console.log(`run ended as a timeout (${why})`);
  }
  if (runId && breach) {
    await admin({ id: runId, hidden: true, reason: `runner lockdown: ${breach}` });
    console.log('run hidden from the boards');
  }
  if (final) console.log(`final: ${final.slice(0, 400)}`);
  if (last) console.log(`result: best level ${last.best_level}, ended ${stopped ? 'timeout' : last.run_end_reason}, replay ${last.replay_url ?? '-'}`);
  process.exitCode = breach ? 3 : code ?? 1;
});
