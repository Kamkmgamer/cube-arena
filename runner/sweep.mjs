#!/usr/bin/env node
// Plays one Verified run per model, one after another, by calling run.mjs.
// Models that already have a finished, visible Verified run on that board
// (same name, effort, size, mode and challenge) are skipped, so a sweep can be
// stopped and started again. Without --go it only prints the plan.
//
//   node --env-file=.env.local runner/sweep.mjs [--models claude-opus-5-5,gpt-6-astra] [--effort high] \
//     [--size 3] [--mode interactive] [--challenge ladder] [--max-minutes 90] [--go]
//
// Each run uses the subscription of the CLI it runs on (Claude Code or Codex).
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SWEEP_MODELS, agentFor, boardLabel, claudeName, codexModels, codexName, effortFor } from './models.mjs';

const { values: opt } = parseArgs({
  options: {
    models: { type: 'string' },
    effort: { type: 'string', default: 'high' },
    size: { type: 'string', default: '3' },
    mode: { type: 'string', default: 'interactive' },
    challenge: { type: 'string', default: 'ladder' },
    url: { type: 'string', default: 'https://cube.krnl.studio/mcp' },
    'max-minutes': { type: 'string', default: '90' },
    'codex-home': { type: 'string', default: join(homedir(), '.codex-bench') },
    go: { type: 'boolean', default: false },
  },
});

const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) {
  console.error('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
  process.exit(2);
}

const models = opt.models ? opt.models.split(',').map((m) => m.trim()) : SWEEP_MODELS;
const listed = codexModels(opt['codex-home']);
const labelOf = (m) => {
  const name = agentFor(m) === 'claude' ? claudeName(m) : codexName(m, listed);
  return name ? boardLabel(name, effortFor(m, opt.effort)) : null;
};

const site = opt.url.replace(/\/mcp\/?$/, '');
const res = await fetch(`${site}/api/admin/runs?limit=500`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`could not list runs: ${res.status}`);
  process.exit(1);
}
const { runs } = await res.json();
const done = new Set(
  runs
    .filter(
      (r) =>
        r.board === 'verified' && r.status === 'finished' && !r.hidden && r.tool_use === 'model_only' &&
        String(r.size) === opt.size && r.mode === opt.mode && r.challenge === opt.challenge,
    )
    .map((r) => r.model_name),
);

const plan = models.map((m) => ({ model: m, label: labelOf(m) }));
for (const p of plan) {
  const state = !p.label ? 'unknown id, skipped' : done.has(p.label) ? 'already played, skipped' : 'to play';
  console.log(`${p.model.padEnd(18)} ${String(p.label ?? '-').padEnd(28)} ${state}`);
}
const todo = plan.filter((p) => p.label && !done.has(p.label));
console.log(`\n${todo.length} run(s): ${opt.size}×${opt.size} ${opt.mode} ${opt.challenge}, effort ${opt.effort}, up to ${opt['max-minutes']} min each.`);
if (!opt.go) {
  console.log('Plan only. Add --go to play.');
  process.exit(0);
}

const run = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs');
for (const [i, p] of todo.entries()) {
  console.log(`\n=== ${i + 1}/${todo.length}: ${p.label} ===`);
  const args = [run, '--model', p.model, '--effort', opt.effort, '--size', opt.size, '--mode', opt.mode, '--challenge', opt.challenge];
  args.push('--url', opt.url, '--max-minutes', opt['max-minutes'], '--codex-home', opt['codex-home']);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (r.status === 3) console.log(`!!! ${p.label}: lockdown broken, run hidden; check the transcript`);
}
