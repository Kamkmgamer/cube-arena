// The game. Every rule is enforced here, on the server: the cube's state never
// leaves it except as a picture, moves are applied by our engine, and solved
// is decided by our engine. Callers (the MCP endpoint) only shape requests.

import { createHash, randomInt } from 'node:crypto';
import { MoveError, applyMoves, isSolved, moveCost, parseMoves, stateFromString, stateToString } from '../cube/engine';
import { fullScramble } from '../cube/random-state';
import { levelScramble, rng } from '../cube/scramble';
import { atlasPng } from '../render/png';
import { type AttemptRow, type RunRow, type Tx, UUID, transaction, withDb } from './db';
import {
  ATTEMPT_MINUTES, type Board, type Challenge, LADDER_LIVES, LADDER_MAX_LEVEL, MAX_INVALID, MAX_LOOKS, MAX_TURN_BATCH, MODE_LABEL, type Mode,
  RUNS_PER_HOUR, RUNS_PER_HOUR_TOTAL, SCRAMBLE_MOVE_CAP, type Size, TOOL_USE_LABEL, type ToolUse, ladderMoveCap,
} from './rules';

export const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://cube.krnl.studio').replace(/\/$/, '');

export class ArenaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Caller {
  board: Board;
  ipHash: string | null;
  client: string | null;
  /** Set by the operator's runner on verified runs; overrides what the model says. */
  operator?: { displayName?: string; modelName?: string; toolUse?: ToolUse };
}

/** What a tool call returns: words for the model, and the cube picture when relevant. */
export interface Reply {
  text: string;
  png?: Buffer;
  data: Record<string, unknown>;
}

export const hashIp = (ip: string | null) =>
  ip ? createHash('sha256').update(`${process.env.CUBE_IP_SALT || 'dev'}:${ip}`).digest('hex').slice(0, 32) : null;

// ---------------------------------------------------------------------------
// Names

const BLOCKED = /(fuck|shit|cunt|nigg|fag|rape|hitler|nazi|whore|slut|bitch|dick|cock|pussy|kkk|porn)/;

function cleanName(raw: unknown, min: number, max: number, what: string): string {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < min || v.length > max) throw new ArenaError('bad_name', `${what} must be ${min} to ${max} characters.`);
  if (!/^[\p{L}\p{N} ._:/()@+#-]+$/u.test(v)) throw new ArenaError('bad_name', `${what} may use letters, numbers, spaces and . _ : / ( ) @ + # - only.`);
  if (BLOCKED.test(v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))) throw new ArenaError('bad_name', `Pick a different ${what.toLowerCase()}.`);
  return v;
}

// ---------------------------------------------------------------------------
// Rendering and wording

function picture(a: AttemptRow): Buffer {
  const caption = a.level ? `level ${a.level}` : 'full scramble';
  return atlasPng(stateFromString(a.state, a.size), a.size, { caption, moves: a.move_count });
}

const replayUrl = (a: AttemptRow) => `${BASE_URL}/replay/${a.id}`;
const imageUrl = (a: AttemptRow) => `${BASE_URL}/api/image/${a.id}?m=${a.move_count}`;

function header(run: RunRow): string {
  const what = run.challenge === 'ladder' ? 'Ladder' : 'Full scramble';
  return `Cube Arena · ${run.size}×${run.size} · ${what} · ${MODE_LABEL[run.mode]} · ${TOOL_USE_LABEL[run.tool_use]}`;
}

function attemptLine(run: RunRow, a: AttemptRow): string {
  const left = a.move_cap - a.move_count;
  if (run.challenge === 'ladder') {
    const exact = a.certified ? `exactly ${a.level} move${a.level === 1 ? '' : 's'} from solved` : `scrambled with ${a.level} random moves`;
    return `Level ${a.level} of ${LADDER_MAX_LEVEL[run.size]} (${exact}). Lives: ${run.lives}. Moves left this attempt: ${left}.`;
  }
  const how = a.scramble_kind === 'random_state' ? 'a uniformly random state' : `${a.scramble?.split(' ').length ?? 0} random moves`;
  return `Full scramble (${how}). Moves allowed: ${left}.`;
}

function howTo(run: RunRow, a: AttemptRow): string {
  if (run.mode === 'one_shot') {
    return `Study the picture and work out the whole solution, then call submit_solution with attempt_id "${a.id}" and every move in order (max ${a.move_cap - a.move_count}). You get one submission; only the final state counts. Use look to see the picture again.`;
  }
  return `Turn the cube with turn(attempt_id "${a.id}", moves), up to ${MAX_TURN_BATCH} moves per call, e.g. "R U R' U'". Each call returns a new picture. The attempt ends as soon as the cube is solved at the end of a call.`;
}

function data(run: RunRow, a: AttemptRow | null, extra: Record<string, unknown> = {}) {
  return {
    run_id: run.id,
    run_status: run.status,
    run_end_reason: run.end_reason,
    lives: run.lives,
    best_level: run.best_level,
    attempt_id: a?.id ?? null,
    attempt_status: a?.status ?? null,
    level: a?.level ?? null,
    moves_used: a?.move_count ?? null,
    moves_left: a ? a.move_cap - a.move_count : null,
    replay_url: a ? replayUrl(a) : null,
    image_url: a ? imageUrl(a) : null,
    ...extra,
  };
}

function presentAttempt(run: RunRow, a: AttemptRow, lead: string[] = []): Reply {
  const text = [...lead, header(run), attemptLine(run, a), `attempt_id: ${a.id}`, howTo(run, a), `The attached image is the cube right now (also at ${imageUrl(a)}).`].join('\n');
  return { text, png: picture(a), data: data(run, a) };
}

// ---------------------------------------------------------------------------
// Attempts

async function newAttempt(tx: Tx, run: RunRow): Promise<AttemptRow> {
  const n = run.size;
  const random = rng(randomInt(0, 2 ** 31));
  let state: string;
  let scramble: string | null;
  let kind: AttemptRow['scramble_kind'];
  let certified = false;
  let cap: number;
  if (run.challenge === 'ladder') {
    const sc = levelScramble(n, run.level, random);
    state = stateToString(sc.state);
    scramble = sc.moves.map((m) => m.token).join(' ');
    kind = 'walk';
    certified = sc.certified;
    cap = ladderMoveCap(n, run.level);
  } else {
    const sc = fullScramble(n, random);
    state = stateToString(sc.state);
    scramble = sc.moves ? sc.moves.join(' ') : null;
    kind = sc.kind;
    cap = SCRAMBLE_MOVE_CAP[n];
  }
  const seq = run.attempts + 1;
  const minutes = ATTEMPT_MINUTES[run.mode];
  const [a] = await tx<AttemptRow[]>`
    insert into cube_arena.attempts
      (run_id, seq, size, mode, level, scramble_kind, scramble, certified, initial_state, state, move_cap, deadline_at)
    values
      (${run.id}, ${seq}, ${n}, ${run.mode}, ${run.challenge === 'ladder' ? run.level : null}, ${kind}, ${scramble}, ${certified},
       ${state}, ${state}, ${cap}, now() + make_interval(mins => ${minutes}::int))
    returning *`;
  await tx`insert into cube_arena.events (attempt_id, kind, move_count, solved, state) values (${a.id}, 'start', 0, false, ${state})`;
  await tx`update cube_arena.runs set attempts = ${seq}, updated_at = now() where id = ${run.id}`;
  run.attempts = seq;
  return a;
}

async function lock(tx: Tx, attemptId: string): Promise<{ run: RunRow; a: AttemptRow }> {
  if (!UUID.test(attemptId)) throw new ArenaError('bad_attempt', 'That attempt_id is not valid. Use the attempt_id from the latest reply.');
  const [a] = await tx<AttemptRow[]>`select * from cube_arena.attempts where id = ${attemptId} for update`;
  if (!a) throw new ArenaError('bad_attempt', 'No attempt with that attempt_id.');
  const [run] = await tx<RunRow[]>`select * from cube_arena.runs where id = ${a.run_id} for update`;
  return { run, a };
}

async function finishRun(tx: Tx, run: RunRow, reason: string) {
  run.status = 'finished';
  run.end_reason = reason;
  await tx`update cube_arena.runs set status = 'finished', end_reason = ${reason}, lives = ${run.lives}, best_level = ${run.best_level},
           solves = ${run.solves}, updated_at = now() where id = ${run.id}`;
}

/** After an attempt ends, move the run on: next level, a retry, or the end. */
async function advance(tx: Tx, run: RunRow, a: AttemptRow): Promise<AttemptRow | null> {
  if (a.status === 'solved') run.solves += 1;
  if (run.challenge === 'scramble') {
    await finishRun(tx, run, a.status === 'solved' ? 'solved' : a.status);
    return null;
  }
  if (a.status === 'gave_up' || a.status === 'timeout') {
    await finishRun(tx, run, a.status);
    return null;
  }
  if (a.status === 'solved') {
    run.best_level = Math.max(run.best_level, a.level ?? 0);
    if (run.level >= LADDER_MAX_LEVEL[run.size]) {
      await finishRun(tx, run, 'cleared');
      return null;
    }
    run.level += 1;
  } else {
    run.lives -= 1;
    if (run.lives <= 0) {
      await finishRun(tx, run, 'out_of_lives');
      return null;
    }
  }
  await tx`update cube_arena.runs set level = ${run.level}, lives = ${run.lives}, best_level = ${run.best_level}, solves = ${run.solves},
           updated_at = now() where id = ${run.id}`;
  return newAttempt(tx, run);
}

async function endAttempt(tx: Tx, a: AttemptRow, status: AttemptRow['status'], detail: string | null) {
  a.status = status;
  a.detail = detail;
  await tx`update cube_arena.attempts set status = ${status}, detail = ${detail}, finished_at = now() where id = ${a.id}`;
}

/** Expired attempts end as timeouts, whoever touches them first. */
async function expireIfLate(tx: Tx, run: RunRow, a: AttemptRow): Promise<boolean> {
  if (a.status !== 'active' || a.deadline_at.getTime() > Date.now()) return false;
  await endAttempt(tx, a, 'timeout', `no result within ${ATTEMPT_MINUTES[a.mode]} minutes`);
  await tx`insert into cube_arena.events (attempt_id, kind, move_count) values (${a.id}, 'timeout', ${a.move_count})`;
  await advance(tx, run, a);
  return true;
}

function finishedReply(run: RunRow, a: AttemptRow, next: AttemptRow | null, lead: string[]): Reply {
  if (next) return presentAttempt(run, next, lead);
  const end: Record<string, string> = {
    cleared: `Run complete: every level cleared!`,
    out_of_lives: `Out of lives. Run over: best level ${run.best_level}.`,
    solved: 'Run complete.',
    gave_up: 'Run ended.',
    timeout: 'Run ended: time ran out.',
  };
  const text = [...lead, end[run.end_reason ?? ''] ?? `Run ended (${run.end_reason}).`, `Replay: ${replayUrl(a)}`, 'Call start_run to play again.'].join('\n');
  return { text, png: picture(a), data: data(run, a) };
}

// ---------------------------------------------------------------------------
// Operations

export interface StartInput {
  size: Size;
  mode: Mode;
  challenge: Challenge;
  display_name: string;
  model_name: string;
  tool_use: ToolUse;
}

export async function startRun(input: StartInput, caller: Caller): Promise<Reply> {
  const display = caller.operator?.displayName ?? cleanName(input.display_name, 2, 32, 'Display name');
  const model = caller.operator?.modelName ?? cleanName(input.model_name, 1, 64, 'Model name');
  const toolUse = caller.operator?.toolUse ?? input.tool_use;
  if (caller.board === 'community') {
    const ipHash = caller.ipHash ?? '';
    const [{ mine, everyone }] = await withDb((sql) => sql<{ mine: number; everyone: number }[]>`
      select count(*) filter (where ip_hash = ${ipHash})::int as mine, count(*)::int as everyone
      from cube_arena.runs where board = 'community' and created_at > now() - interval '1 hour'`);
    if (ipHash && mine >= RUNS_PER_HOUR) throw new ArenaError('slow_down', `Too many new runs from here (limit ${RUNS_PER_HOUR} an hour). Try again later.`);
    if (everyone >= RUNS_PER_HOUR_TOTAL) throw new ArenaError('slow_down', 'Cube Arena is very busy right now. Try again in a little while.');
  }
  return transaction(async (tx) => {
    const lives = input.challenge === 'ladder' ? LADDER_LIVES : 1;
    const level = input.challenge === 'ladder' ? 1 : 0;
    const [run] = await tx<RunRow[]>`
      insert into cube_arena.runs (board, display_name, model_name, tool_use, client, size, mode, challenge, lives, level, ip_hash)
      values (${caller.board}, ${display}, ${model}, ${toolUse}, ${caller.client}, ${input.size}, ${input.mode}, ${input.challenge},
              ${lives}, ${level}, ${caller.ipHash})
      returning *`;
    const a = await newAttempt(tx, run);
    const board = caller.board === 'verified' ? 'Verified board' : 'Community board (self-reported)';
    return presentAttempt(run, a, [`Run started for ${display} / ${model} on the ${board}. Run id: ${run.id}`]);
  });
}

export async function look(attemptId: string): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId);
    if (await expireIfLate(tx, run, a)) return finishedReply(run, a, null, ['Time is up for this attempt.']);
    if (a.status !== 'active') {
      const [next] = await tx<AttemptRow[]>`select * from cube_arena.attempts where run_id = ${run.id} and status = 'active' order by seq desc limit 1`;
      if (next) return presentAttempt(run, next, [`That attempt is over (${a.status}). This is the run's current attempt:`]);
      return finishedReply(run, a, null, [`That attempt is over (${a.status}).`]);
    }
    if (a.looks >= MAX_LOOKS) throw new ArenaError('look_limit', `That's all ${MAX_LOOKS} looks for this attempt. The last picture you got is still the current cube.`);
    await tx`update cube_arena.attempts set looks = looks + 1 where id = ${a.id}`;
    await tx`insert into cube_arena.events (attempt_id, kind, move_count) values (${a.id}, 'look', ${a.move_count})`;
    return presentAttempt(run, a);
  });
}

/** A rejected request: counts toward the attempt's invalid limit, changes nothing else. */
async function reject(tx: Tx, run: RunRow, a: AttemptRow, error: string, moves: string[] | null): Promise<Reply> {
  a.invalid += 1;
  await tx`update cube_arena.attempts set invalid = ${a.invalid} where id = ${a.id}`;
  await tx`insert into cube_arena.events (attempt_id, kind, moves, move_count, error) values (${a.id}, 'invalid', ${moves ? tx.array(moves) : null}, ${a.move_count}, ${error})`;
  if (a.invalid >= MAX_INVALID) {
    await endAttempt(tx, a, 'invalid', `${MAX_INVALID} invalid requests`);
    const next = await advance(tx, run, a);
    return finishedReply(run, a, next, [`Rejected: ${error}`, `That was the ${MAX_INVALID}th invalid request, so this attempt failed.`]);
  }
  return {
    text: `Rejected, nothing changed: ${error}\nInvalid requests on this attempt: ${a.invalid} of ${MAX_INVALID}. attempt_id: ${a.id}`,
    data: data(run, a, { error }),
  };
}

function parse(a: AttemptRow, raw: string | string[]) {
  try {
    const moves = parseMoves(raw, a.size);
    if (moves.length === 0) return { error: 'no moves given.' };
    return { moves };
  } catch (e) {
    if (e instanceof MoveError) return { error: e.message };
    throw e;
  }
}

export async function turn(attemptId: string, raw: string | string[]): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId);
    if (await expireIfLate(tx, run, a)) return finishedReply(run, a, null, ['Time is up for this attempt.']);
    if (a.status !== 'active') throw new ArenaError('over', `That attempt is over (${a.status}). Use the attempt_id from the latest reply, or call look.`);
    if (a.mode !== 'interactive') throw new ArenaError('wrong_mode', 'This is a one-shot run: send every move at once with submit_solution.');
    const p = parse(a, raw);
    if (!p.moves) return reject(tx, run, a, p.error!, null);
    const tokens = p.moves.map((m) => m.token);
    if (p.moves.length > MAX_TURN_BATCH) return reject(tx, run, a, `at most ${MAX_TURN_BATCH} moves per turn call (got ${p.moves.length}).`, tokens);
    const cost = moveCost(p.moves);
    if (a.move_count + cost > a.move_cap) {
      return reject(tx, run, a, `that would use ${cost} moves but only ${a.move_cap - a.move_count} are left.`, tokens);
    }
    const s = applyMoves(stateFromString(a.state, a.size), a.size, p.moves);
    const solved = isSolved(s, a.size);
    a.state = stateToString(s);
    a.move_count += cost;
    a.turns += 1;
    a.moves = [...a.moves, ...tokens];
    await tx`update cube_arena.attempts set state = ${a.state}, move_count = ${a.move_count}, turns = ${a.turns},
             moves = moves || ${tx.array(tokens)}::text[] where id = ${a.id}`;
    await tx`insert into cube_arena.events (attempt_id, kind, moves, move_count, solved, state)
             values (${a.id}, 'turn', ${tx.array(tokens)}, ${a.move_count}, ${solved}, ${a.state})`;
    if (solved) {
      await endAttempt(tx, a, 'solved', null);
      const next = await advance(tx, run, a);
      const what = a.level ? `level ${a.level}` : 'the cube';
      return finishedReply(run, a, next, [`Solved ${what} in ${a.move_count} move${a.move_count === 1 ? '' : 's'}!${next ? ' Next up:' : ''}`]);
    }
    if (a.move_count >= a.move_cap) {
      await endAttempt(tx, a, 'failed', 'move limit reached');
      const next = await advance(tx, run, a);
      return finishedReply(run, a, next, [`Move limit reached without solving. Attempt failed.${next ? ` Lives left: ${run.lives}.` : ''}`]);
    }
    return presentAttempt(run, a, [`Applied ${tokens.join(' ')}. Not solved yet.`]);
  });
}

export async function submitSolution(attemptId: string, raw: string | string[]): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId);
    if (await expireIfLate(tx, run, a)) return finishedReply(run, a, null, ['Time is up for this attempt.']);
    if (a.status !== 'active') throw new ArenaError('over', `That attempt is over (${a.status}). Use the attempt_id from the latest reply, or call look.`);
    if (a.mode !== 'one_shot') throw new ArenaError('wrong_mode', 'This is an interactive run: use turn.');
    // Unreadable or over-long lists are refused without using up the one
    // submission: those checks never depend on the cube, so they leak nothing.
    const p = parse(a, raw);
    if (!p.moves) return reject(tx, run, a, `${p.error} Your submission was not used; send a corrected one.`, null);
    const tokens = p.moves.map((m) => m.token);
    const cost = moveCost(p.moves);
    if (cost > a.move_cap) return reject(tx, run, a, `${cost} moves is over this attempt's limit of ${a.move_cap}. Your submission was not used.`, tokens);
    const s = applyMoves(stateFromString(a.state, a.size), a.size, p.moves);
    const solved = isSolved(s, a.size);
    a.state = stateToString(s);
    a.move_count = cost;
    a.moves = tokens;
    a.turns = 1;
    await tx`update cube_arena.attempts set state = ${a.state}, move_count = ${cost}, turns = 1, moves = ${tx.array(tokens)}::text[] where id = ${a.id}`;
    await tx`insert into cube_arena.events (attempt_id, kind, moves, move_count, solved, state)
             values (${a.id}, 'submit', ${tx.array(tokens)}, ${cost}, ${solved}, ${a.state})`;
    await endAttempt(tx, a, solved ? 'solved' : 'failed', solved ? null : 'final state not solved');
    const next = await advance(tx, run, a);
    const what = a.level ? `Level ${a.level}` : 'The cube';
    const lead = solved
      ? [`Correct! ${what} solved in ${cost} move${cost === 1 ? '' : 's'}.${next ? ' Next up:' : ''}`]
      : [`Not solved: after your ${cost} moves the cube is not solved (picture at ${imageUrl(a)}).${next && run.challenge === 'ladder' ? ` Lives left: ${run.lives}. Try again with a new cube at the same level:` : ''}`];
    return finishedReply(run, a, next, lead);
  });
}

export async function giveUp(attemptId: string): Promise<Reply> {
  return transaction(async (tx) => {
    const { run, a } = await lock(tx, attemptId);
    if (a.status !== 'active') throw new ArenaError('over', `That attempt is already over (${a.status}).`);
    await endAttempt(tx, a, 'gave_up', null);
    await tx`insert into cube_arena.events (attempt_id, kind, move_count) values (${a.id}, 'give_up', ${a.move_count})`;
    await advance(tx, run, a);
    return finishedReply(run, a, null, [`Gave up. Best level: ${run.best_level}.`]);
  });
}

/** End attempts and runs nobody came back to. Cheap; called by pages. */
export async function sweepExpired(): Promise<void> {
  const late = await withDb((sql) => sql<{ id: string }[]>`
    select id from cube_arena.attempts where status = 'active' and deadline_at < now() order by deadline_at limit 25`);
  for (const { id } of late) {
    await transaction(async (tx) => {
      const { run, a } = await lock(tx, id);
      await expireIfLate(tx, run, a);
    });
  }
}
