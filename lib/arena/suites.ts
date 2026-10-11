// Suites: fixed sets of tests played one after another and graded together
// into one score out of 100. Model only: the index measures the model, not
// its tools. Every model gets the same cubes (seeded per suite version), and
// each test has a time budget, so speed counts through how far a model gets.
//
// Changing the tests or the grading means a new version: scores only compare
// within one version.

import { createHmac } from 'node:crypto';
import { type Challenge, LADDER_MAX_LEVEL, type Mode, SIZES, type Size } from './rules';

export type SuiteKind = 'fast' | 'thorough';
export const SUITE_KINDS: SuiteKind[] = ['fast', 'thorough'];

export interface SuiteSlot {
  /** Which test this slot belongs to; a test can have several cubes (slots). */
  test: string;
  size: Size;
  challenge: Challenge;
  mode: Mode;
  /** Time budget for this slot's run. */
  minutes: number;
}

export interface SuiteDef {
  kind: SuiteKind;
  version: string;
  name: string;
  blurb: string;
  slots: SuiteSlot[];
}

const testId = (size: Size, challenge: Challenge, mode: Mode) => `${size}x${size}-${challenge}-${mode}`;
const slot = (size: Size, challenge: Challenge, mode: Mode, minutes: number): SuiteSlot => ({ test: testId(size, challenge, mode), size, challenge, mode, minutes });

export const SUITES: Record<SuiteKind, SuiteDef> = {
  fast: {
    kind: 'fast',
    version: 'v1',
    name: 'Fast',
    blurb: 'Three ladders with 15 minutes each: 2×2 and 3×3 interactive, and 3×3 one-shot. About 45 minutes at most.',
    slots: [slot(2, 'ladder', 'interactive', 15), slot(3, 'ladder', 'interactive', 15), slot(3, 'ladder', 'one_shot', 15)],
  },
  thorough: {
    kind: 'thorough',
    version: 'v1',
    name: 'Thorough',
    blurb:
      'Every model-only test: 2×2 to 5×5, ladder and full scramble, interactive and one-shot. Ladders get 30 minutes, and each full scramble two cubes of 15 minutes. Up to about 8 hours.',
    slots: SIZES.flatMap((s) => [
      slot(s, 'ladder', 'interactive', 30),
      slot(s, 'ladder', 'one_shot', 30),
      slot(s, 'scramble', 'interactive', 15),
      slot(s, 'scramble', 'interactive', 15),
      slot(s, 'scramble', 'one_shot', 15),
      slot(s, 'scramble', 'one_shot', 15),
    ]),
  },
};

/** The distinct tests of a suite, in order, with how many cubes (slots) each has. */
export function suiteTests(def: SuiteDef): { test: string; size: Size; challenge: Challenge; mode: Mode; slots: number[] }[] {
  const out: { test: string; size: Size; challenge: Challenge; mode: Mode; slots: number[] }[] = [];
  def.slots.forEach((s, i) => {
    const t = out.find((x) => x.test === s.test);
    if (t) t.slots.push(i);
    else out.push({ test: s.test, size: s.size, challenge: s.challenge, mode: s.mode, slots: [i] });
  });
  return out;
}

export const suiteMinutes = (def: SuiteDef) => def.slots.reduce((a, s) => a + s.minutes, 0);

/**
 * The seed for one cube of a suite: the same for every model, unknowable
 * without the server's secret. `attempt` counts tries at that level, so a
 * retry after a lost life is a new cube, the same new cube for everyone.
 */
export function suiteSeed(kind: SuiteKind, version: string, slotIndex: number, level: number | null, attempt: number): number {
  const secret = process.env.CUBE_SUITE_SECRET || process.env.CUBE_IP_SALT || 'dev';
  return createHmac('sha256', secret).update(`suite:${kind}:${version}:${slotIndex}:${level ?? 'full'}:${attempt}`).digest().readUInt32BE(0);
}

// ---------------------------------------------------------------------------
// Grading

/** How much of a test's points depend on using few moves. Solving counts for the rest. */
export const EFFICIENCY_WEIGHT = 0.2;

/** Full scrambles: the move count that counts as fully efficient. 2×2 and 3×3: the most any position needs; 4×4 and 5×5: our scramble length. */
export const SCRAMBLE_REFERENCE: Record<Size, number> = { 2: 11, 3: 20, 4: 40, 5: 60 };

export interface GradedAttempt {
  level: number | null;
  status: string;
  move_count: number;
}

export interface GradedRun {
  size: Size;
  challenge: Challenge;
  best_level: number;
  attempts: GradedAttempt[];
}

/** 1 when a cube took no more moves than its reference, less the more it took. */
export const efficiency = (reference: number, moves: number) => (moves <= 0 ? 1 : Math.min(1, reference / moves));

const blend = (eff: number) => 1 - EFFICIENCY_WEIGHT + EFFICIENCY_WEIGHT * eff;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Ladder: share of the ladder climbed, scaled by efficiency (a level-N cube is N moves from solved). */
export function ladderScore(run: GradedRun): number {
  const solved = run.attempts.filter((a) => a.status === 'solved' && a.level);
  if (!solved.length || run.best_level <= 0) return 0;
  const eff = mean(solved.map((a) => efficiency(a.level as number, a.move_count)));
  return (100 * run.best_level * blend(eff)) / LADDER_MAX_LEVEL[run.size];
}

/** Full scramble: 100 for a solve at or under the reference, less for long solves, 0 for a miss. */
export function scrambleScore(run: GradedRun): number {
  const a = run.attempts.find((x) => x.status === 'solved');
  return a ? 100 * blend(efficiency(SCRAMBLE_REFERENCE[run.size], a.move_count)) : 0;
}

export const runScore = (run: GradedRun) => (run.challenge === 'ladder' ? ladderScore(run) : scrambleScore(run));

export interface SuiteGrade {
  /** 0-100, or null while a test has not been played yet (active suites). */
  score: number | null;
  tests: { test: string; size: Size; challenge: Challenge; mode: Mode; score: number | null; played: number; cubes: number }[];
}

/**
 * Each test scores the mean of its cubes; the suite scores the mean of its
 * tests. Once a suite is over, tests never played count as 0.
 */
export function gradeSuite(def: SuiteDef, runsBySlot: Map<number, GradedRun>, finished: boolean): SuiteGrade {
  const tests = suiteTests(def).map((t) => {
    const played = t.slots.filter((i) => runsBySlot.has(i));
    const complete = played.length === t.slots.length;
    const scores = t.slots.map((i) => (runsBySlot.has(i) ? runScore(runsBySlot.get(i) as GradedRun) : 0));
    return {
      test: t.test,
      size: t.size,
      challenge: t.challenge,
      mode: t.mode,
      score: complete || finished ? mean(scores) : null,
      played: played.length,
      cubes: t.slots.length,
    };
  });
  const all = tests.every((t) => t.score !== null);
  return { score: all ? mean(tests.map((t) => t.score as number)) : null, tests };
}

/** Told to players at the start of every suite test. */
export const SUITE_SCORING =
  `Suite scoring: each test scores 0-100. Ladder: how far up you climb; full scramble: whether you solve it. Up to ${EFFICIENCY_WEIGHT * 100}% of each test is for using few moves (a level-N cube needs N). ` +
  'Time counts through the budget: when it runs out, the test ends where you are. The suite score is the average of its tests.';
