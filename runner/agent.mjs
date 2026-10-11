// One agent session against Cube Arena: Claude Code or Codex, locked down to
// the cube tools, watched as it plays. Used by run.mjs (one run) and
// suite.mjs (one fresh session per suite test).
//
// Lockdown: the agent gets the cube tools and nothing else (no shell, files,
// code or web). Anything else showing up in the stream stops the session and
// hides the run. Claude sessions also check that the model that answered is
// the one asked for (the CLI quietly serves some retired ids with another).
//
// Codex runs use their own CODEX_HOME (default ~/.codex-bench, signed in once
// with `CODEX_HOME=~/.codex-bench codex login --device-auth`), so no
// AGENTS.md, config, skills or memories from this machine reach the model.

import { spawn } from 'node:child_process';
import { createWriteStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SYSTEM =
  'You are taking part in Cube Arena, a benchmark where an AI solves a twisty cube puzzle from pictures. ' +
  'Your only tools are the cube-arena tools. Work everything out yourself from the images; there is nothing else to use.';

/** Operator calls to the site, to end, hide or annotate runs and suites. */
export function operator(url, token) {
  const site = url.replace(/\/mcp\/?$/, '');
  return async (path, body) => {
    const res = await fetch(`${site}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error ?? ''}`);
    return json;
  };
}

function claudeCommand(s, work) {
  const config = join(work, 'mcp.json');
  writeFileSync(
    config,
    JSON.stringify({ mcpServers: { 'cube-arena': { type: 'http', url: s.url, headers: { Authorization: `Bearer ${s.token}`, ...s.headers } } } }),
    { mode: 0o600 },
  );
  // --tools '' leaves no built-in tools; --setting-sources local reads settings
  // only from the (empty) working directory, so no CLAUDE.md, plugins or hooks
  // from this machine reach the model. (--safe-mode would also drop the cube server.)
  const args = ['-p', s.prompt, '--model', s.model, '--system-prompt', SYSTEM, '--tools', ''];
  if (s.effort) args.push('--effort', s.effort);
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

function codexCommand(s, work) {
  const instructions = join(work, 'instructions.md');
  writeFileSync(instructions, `${SYSTEM}\n`);
  const toml = JSON.stringify; // a JSON string is a valid TOML basic string
  const table = `{${Object.entries(s.headers)
    .map(([k, v]) => `${toml(k)}=${toml(String(v))}`)
    .join(',')}}`;
  const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only'];
  args.push('-m', s.model);
  if (s.effort) args.push('-c', `model_reasoning_effort=${toml(s.effort)}`);
  for (const f of CODEX_OFF) args.push('--disable', f);
  args.push('-c', 'agents.enabled=false', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0');
  args.push('-c', `model_instructions_file=${toml(instructions)}`);
  args.push('-c', 'features.code_mode.direct_only_tool_namespaces=["mcp__cube_arena"]');
  args.push('-c', `mcp_servers.cube-arena.url=${toml(s.url)}`);
  args.push('-c', 'mcp_servers.cube-arena.bearer_token_env_var="CUBE_OPERATOR_TOKEN"');
  args.push('-c', `mcp_servers.cube-arena.http_headers=${table}`);
  args.push(s.prompt);
  return { cmd: 'codex', args, env: { ...process.env, CUBE_OPERATOR_TOKEN: s.token, CODEX_HOME: s.codexHome } };
}

// Transcripts keep everything but the pictures, which the site can redraw.
const slim = (line) => line.replace(/"data":"[A-Za-z0-9+/=]{200,}"/g, (m) => `"data":"<${m.length - 9} base64 chars>"`);

/**
 * Plays one session. `s`: { agent, model, effort, prompt, headers, url, token,
 * maxMinutes, codexHome, logPath }. Resolves when the agent exits, after any
 * run it left open is ended as a timeout and a lockdown breach is hidden.
 */
export function playSession(s) {
  const work = mkdtempSync(join(tmpdir(), 'cube-runner-'));
  const { cmd, args, env } = s.agent === 'claude' ? claudeCommand(s, work) : codexCommand(s, work);
  const call = operator(s.url, s.token);
  const log = createWriteStream(s.logPath);
  const started = Date.now();
  const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
  const child = spawn(cmd, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });

  const out = { runId: null, runOver: false, last: null, calls: 0, breach: null, stopReason: null, final: null, usage: {}, code: null, minutes: 0 };
  const claudeUsage = new Map(); // message id → usage (stream-json repeats a message per content block)

  function stop(reason) {
    if (out.stopReason) return;
    out.stopReason = reason;
    console.log(`  stopping: ${reason}`);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
  }
  const killer = setTimeout(() => stop(`the runner's ${s.maxMinutes}-minute limit`), s.maxMinutes * 60_000);

  function lockdown(what) {
    if (out.breach) return;
    out.breach = what;
    stop(`lockdown broken: ${what}`);
  }

  function seeReply(text) {
    const first = text.split('\n')[0];
    if (first) console.log(`      → ${first.slice(0, 140)}`);
    try {
      const data = JSON.parse(text.slice(text.lastIndexOf('\n{') + 1));
      if (data.run_id) out.runId = data.run_id;
      if (data.run_status === 'finished') out.runOver = true;
      if (data.run_status === 'active') out.runOver = false;
      out.last = data;
    } catch {
      // not a game reply
    }
  }

  function seeCall(tool, input) {
    out.calls += 1;
    console.log(`  [${secs()}] ${tool} ${JSON.stringify(input ?? {}).slice(0, 120)}`);
  }

  // Claude Code stream-json.
  function onClaude(ev) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.model !== s.model) lockdown(`asked for ${s.model}, the CLI started ${ev.model}`);
      const extra = (ev.tools ?? []).filter((t) => !t.startsWith('mcp__cube-arena__'));
      if (extra.length) lockdown(`tools besides the cube: ${extra.join(', ')}`);
    }
    if (ev.type === 'assistant') {
      if (ev.message?.model && ev.message.model !== s.model) lockdown(`${ev.message.model} answered, not ${s.model}`);
      if (ev.message?.id && ev.message.usage) claudeUsage.set(ev.message.id, ev.message.usage);
    }
    for (const part of ev.message?.content ?? []) {
      if (part.type === 'tool_use') {
        if (!part.name.startsWith('mcp__cube-arena__')) lockdown(`called ${part.name}`);
        seeCall(part.name.replace('mcp__cube-arena__', ''), part.input);
      }
      if (part.type === 'tool_result') seeReply((Array.isArray(part.content) ? part.content : []).find((c) => c.type === 'text')?.text ?? '');
    }
    if (ev.type === 'result') {
      out.final = String(ev.result ?? '');
      if (Number.isFinite(ev.total_cost_usd)) out.usage.cost_usd = ev.total_cost_usd;
    }
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
        out.final = item.text;
        console.log(`  [${secs()}] says: ${item.text.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
    if (ev.type === 'turn.completed' && ev.usage) {
      const u = ev.usage;
      const add = (k, v) => {
        if (Number.isFinite(v)) out.usage[k] = (out.usage[k] ?? 0) + v;
      };
      add('input_tokens', u.input_tokens);
      add('cached_input_tokens', u.cached_input_tokens);
      add('output_tokens', u.output_tokens);
      add('reasoning_tokens', u.reasoning_output_tokens);
    }
    if (ev.type === 'turn.failed' || ev.type === 'error') console.log(`  [${secs()}] ${ev.type}: ${JSON.stringify(ev.error ?? ev.message).slice(0, 200)}`);
  }

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
      if (s.agent === 'claude') onClaude(ev);
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

  return new Promise((resolve) => {
    child.on('close', async (code) => {
      clearTimeout(killer);
      log.end();
      rmSync(work, { recursive: true, force: true });
      out.code = code;
      out.minutes = (Date.now() - started) / 60_000;
      if (s.agent === 'claude') {
        // Input counted the way OpenAI does: everything read, cached reads included.
        for (const u of claudeUsage.values()) {
          const read = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          out.usage.input_tokens = (out.usage.input_tokens ?? 0) + read;
          out.usage.cached_input_tokens = (out.usage.cached_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          out.usage.output_tokens = (out.usage.output_tokens ?? 0) + (u.output_tokens ?? 0);
        }
      }
      try {
        if (out.runId && !out.runOver) {
          const why = out.stopReason ? `stopped by ${out.stopReason}` : 'the agent stopped before the run was over';
          await call('/api/admin/runs', { id: out.runId, stop: true, reason: why });
          console.log(`  run ended as a timeout (${why})`);
        }
        if (out.runId) await call('/api/admin/runs', { id: out.runId, usage: out.usage });
        if (out.runId && out.breach) {
          await call('/api/admin/runs', { id: out.runId, hidden: true, reason: `runner lockdown: ${out.breach}` });
          console.log('  hidden from the boards');
        }
      } catch (e) {
        console.log(`  (operator call failed: ${e.message})`);
      }
      resolve(out);
    });
  });
}
