// End-to-end check of the MCP endpoint against a running server.
//   node --env-file=.env.local scripts/smoke.mjs http://127.0.0.1:3060/mcp
// It cheats on purpose: it reads each scramble from the database and sends the
// inverse, to prove that solving advances the ladder.
import postgres from 'postgres';

const url = process.argv[2] || 'http://127.0.0.1:3060/mcp';
const sql = postgres(process.env.CUBE_DATABASE_URL, { prepare: false, max: 1, ssl: 'require' });
let id = 0;
async function rpc(method, params, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const call = async (name, args, headers) => {
  const r = await rpc('tools/call', { name, arguments: args }, headers);
  const text = r.content.find((c) => c.type === 'text')?.text ?? '';
  const images = r.content.filter((c) => c.type === 'image').length;
  const at = text.lastIndexOf('\n{');
  const data = at >= 0 ? JSON.parse(text.slice(at)) : {};
  return { text, images, data, isError: r.isError };
};
const inverse = (alg) => alg.split(' ').reverse().map((t) => (t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`)).join(' ');
const scrambleOf = async (attemptId) => (await sql`select scramble from cube_arena.attempts where id = ${attemptId}`)[0].scramble;
const ok = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); console.log(`ok   ${msg}`); };

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  ok(init.serverInfo.name === 'cube-arena', 'initialize');
  const tools = await rpc('tools/list', {});
  ok(['start_run', 'look', 'turn', 'submit_solution', 'give_up', 'get_rules'].every((t) => tools.tools.some((x) => x.name === t)), 'tools/list has all six tools');

  const rules = await rpc('tools/call', { name: 'get_rules', arguments: {} });
  ok(rules.content.filter((c) => c.type === 'image').length === 2, 'get_rules returns two example images');

  // Interactive ladder: solve levels 1-3 with the inverse, then fail level 4 three times.
  let r = await call('start_run', { size: 3, mode: 'interactive', challenge: 'ladder', display_name: 'Smoke Test', model_name: 'smoke-bot', tool_use: 'solver' });
  ok(r.images === 1 && r.data.level === 1 && r.data.lives === 3, 'start_run returns level 1 with an image');
  const runId = r.data.run_id;
  r = await call('turn', { attempt_id: r.data.attempt_id, moves: 'R Q' });
  ok(r.text.startsWith('Rejected') && r.data.error, 'bad move rejected without changing anything');
  for (let level = 1; level <= 3; level++) {
    const att = r.data.attempt_id;
    r = await call('turn', { attempt_id: att, moves: inverse(await scrambleOf(att)) });
    ok(r.text.includes(`Solved level ${level}`) && r.data.level === level + 1, `level ${level} solved, now on level ${level + 1}`);
  }
  r = await call('look', { attempt_id: r.data.attempt_id });
  ok(r.images === 1 && r.data.level === 4, 'look shows the current cube');
  r = await call('give_up', { attempt_id: r.data.attempt_id });
  ok(r.data.run_status === 'finished' && r.data.best_level === 3, 'give_up ends the run with best level 3');

  // One-shot ladder: a wrong submission costs a life and gives a fresh cube at the same level.
  r = await call('start_run', { size: 2, mode: 'one_shot', challenge: 'ladder', display_name: 'Smoke Test', model_name: 'smoke-bot', tool_use: 'solver' });
  const first = r.data.attempt_id;
  r = await call('submit_solution', { attempt_id: first, moves: 'U U U U' });
  ok(r.text.startsWith('Not solved') && r.data.lives === 2 && r.data.level === 1 && r.data.attempt_id !== first, 'wrong one-shot costs a life, same level, new cube');
  r = await call('submit_solution', { attempt_id: first, moves: 'U' });
  ok(r.isError && /over/.test(r.text), 'cannot submit twice to the same cube');
  const [{ id: second }] = await sql`select id from cube_arena.attempts where run_id = (select run_id from cube_arena.attempts where id = ${first}) and status = 'active'`;
  r = await call('submit_solution', { attempt_id: second, moves: 'garbage' });
  ok(r.text.startsWith('Rejected') && /not used/.test(r.text), 'unreadable one-shot is refused without using the submission');

  // Verified board via operator token.
  r = await call('start_run', { size: 4, mode: 'interactive', challenge: 'scramble', display_name: 'ignored', model_name: 'ignored', tool_use: 'model_only' },
    { authorization: `Bearer ${process.env.CUBE_OPERATOR_TOKEN}`, 'x-arena-model': 'smoke-verified', 'x-arena-tool-use': 'code' });
  const [run] = await sql`select board, model_name, tool_use from cube_arena.runs where id = ${r.data.run_id}`;
  ok(run.board === 'verified' && run.model_name === 'smoke-verified' && run.tool_use === 'code', 'operator token puts the run on the verified board');
  await call('give_up', { attempt_id: r.data.attempt_id });

  const img = await fetch(url.replace('/mcp', `/api/image/${first}`));
  ok(img.headers.get('content-type') === 'image/png' && (await img.arrayBuffer()).byteLength > 10000, 'image endpoint serves a PNG');
  console.log('all good; smoke runs are named "Smoke Test" (delete them before launch)', runId);
} finally {
  await sql.end();
}
