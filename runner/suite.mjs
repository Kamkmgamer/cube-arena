#!/usr/bin/env node
// Plays a whole suite (the Cube Arena Index) on the Verified board: creates
// the suite, then plays each test in a fresh agent session that may only
// touch that test, so hours of pictures never pile up in one context.
//
//   node --env-file=.env.local runner/suite.mjs --model gpt-6-luna --effort max --suite fast
//   node --env-file=.env.local runner/suite.mjs --resume <suite id> --model gpt-6-luna --effort max
//
// A lockdown breach hides the whole suite and stops. Tests the agent never
// started count 0. Needs CUBE_OPERATOR_TOKEN.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { operator, playSession } from './agent.mjs';
import { resolveModel } from './models.mjs';

const { values: opt } = parseArgs({
  options: {
    model: { type: 'string' },
    effort: { type: 'string', default: 'max' },
    suite: { type: 'string', default: 'fast' },
    resume: { type: 'string' },
    url: { type: 'string', default: 'https://cube.krnl.studio/mcp' },
    name: { type: 'string', default: 'Cube Arena' },
    // Extra minutes per session on top of the test's budget (reading the rules, thinking past the deadline).
    slack: { type: 'string', default: '6' },
    'codex-home': { type: 'string', default: join(homedir(), '.codex-bench') },
  },
});

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const token = process.env.CUBE_OPERATOR_TOKEN;
if (!token) fail('CUBE_OPERATOR_TOKEN is not set (run with --env-file=.env.local)');
if (!opt.model) fail('--model is required: the full model id, e.g. claude-opus-5-5 or gpt-6-luna');
if (!['fast', 'thorough'].includes(opt.suite)) fail('--suite must be fast or thorough');
const m = resolveModel(opt.model, opt.effort, opt['codex-home']);
if (m.error) fail(m.error);

// The tests (and their time budgets) come from the server: lib/arena/suites.ts.
const call = operator(opt.url, token);
let suite;
let slots;
let played = new Set();
if (opt.resume) {
  ({ suite, tests: slots } = await call(`/api/admin/suites?id=${opt.resume}`));
  if (suite.model_name !== m.label || suite.kind !== opt.suite) fail(`That suite is ${suite.kind} for ${suite.model_name}, not ${opt.suite} for ${m.label}.`);
  played = new Set(suite.slots_played ?? []);
} else {
  ({ suite, tests: slots } = await call('/api/admin/suites', {
    kind: opt.suite,
    model_name: m.label,
    model: m.name,
    model_id: opt.model,
    effort: m.effort,
    agent: m.agent,
    display_name: opt.name,
  }));
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
console.log(`${m.label} [${opt.model}, ${m.agent}]: ${opt.suite} suite ${suite.version}, ${slots.length} tests → ${opt.url}`);
console.log(`suite ${suite.id}`);
const started = Date.now();

for (const [i, t] of slots.entries()) {
  if (played.has(i)) continue;
  const what = `${t.size}×${t.size} ${t.challenge === 'ladder' ? 'ladder' : 'full scramble'}, ${t.mode === 'one_shot' ? 'one-shot' : 'interactive'}`;
  console.log(`\n=== test ${i + 1}/${slots.length}: ${what}, ${t.minutes} min ===`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prompt =
    `Let's play Cube Arena. First call get_rules. Then call next_test with suite_id "${suite.id}": it starts your test ` +
    `(test ${i + 1} of ${slots.length}: ${what}, ${t.minutes} minutes). Solve each cube from the pictures only, in as few moves as you can. ` +
    'Play until this test ends, then stop and reply with your result in one line. Do not start another test.';
  const r = await playSession({
    agent: m.agent,
    model: opt.model,
    effort: m.effort,
    prompt,
    headers: { 'x-arena-model': m.label, 'x-arena-tool-use': 'model_only', 'x-arena-name': opt.name, 'x-arena-suite-slot': String(i) },
    url: opt.url,
    token,
    maxMinutes: t.minutes + Number(opt.slack),
    codexHome: opt['codex-home'],
    logPath: join(out, `${stamp}-${opt.model}-${m.effort ?? 'default'}-${opt.suite}-${i + 1}.jsonl`),
  });
  const cost = r.usage.cost_usd !== undefined ? `, $${r.usage.cost_usd.toFixed(2)}` : '';
  const tokens = r.usage.output_tokens !== undefined ? `, ${r.usage.input_tokens ?? 0} in / ${r.usage.output_tokens} out tokens` : '';
  console.log(`  done in ${r.minutes.toFixed(1)} min, ${r.calls} tool calls${tokens}${cost}`);
  if (r.last) console.log(`  best level ${r.last.best_level}, replay ${r.last.replay_url ?? '-'}`);
  if (!r.runId) console.log('  !! the agent never started this test; it counts 0');
  if (r.breach) {
    console.log(`!!! lockdown broken (${r.breach}); the suite is hidden. Stopping.`);
    process.exit(3);
  }
}

const { result, suite: done } = await call('/api/admin/suites', { id: suite.id, finish: true });
console.log(`\n${result}`);
for (const t of done.grade?.tests ?? []) console.log(`  ${t.test.padEnd(26)} ${t.score === null ? '-' : t.score.toFixed(1).padStart(5)}  (${t.played}/${t.cubes} cubes)`);
console.log(`total ${((Date.now() - started) / 60_000).toFixed(1)} min`);
