import { describe, expect, it } from 'vitest';
import { fullScramble } from '../lib/cube/random-state';
import { levelScramble, rng } from '../lib/cube/scramble';
import { stateToString } from '../lib/cube/engine';
import { type GradedRun, SUITES, gradeSuite, ladderScore, scrambleScore, suiteMinutes, suiteSeed, suiteTests } from '../lib/arena/suites';

const ladder = (size: 2 | 3, best: number, moves: number[], extra: GradedRun['attempts'] = []): GradedRun => ({
  size,
  challenge: 'ladder',
  best_level: best,
  attempts: [...moves.map((m, i) => ({ level: i + 1, status: 'solved', move_count: m })), ...extra],
});

describe('suites', () => {
  it('fast is three 15-minute ladders; thorough covers every model-only test', () => {
    expect(SUITES.fast.slots).toHaveLength(3);
    expect(suiteMinutes(SUITES.fast)).toBe(45);
    expect(suiteTests(SUITES.thorough)).toHaveLength(16);
    expect(SUITES.thorough.slots).toHaveLength(24);
    expect(suiteMinutes(SUITES.thorough)).toBe(480);
  });

  it('gives every model the same cubes, and a fresh cube on a retry', () => {
    const a = suiteSeed('fast', 'v1', 1, 4, 0);
    expect(suiteSeed('fast', 'v1', 1, 4, 0)).toBe(a);
    expect(suiteSeed('fast', 'v1', 1, 4, 1)).not.toBe(a);
    expect(suiteSeed('fast', 'v2', 1, 4, 0)).not.toBe(a);
    const s1 = stateToString(levelScramble(3, 5, rng(a)).state);
    expect(stateToString(levelScramble(3, 5, rng(a)).state)).toBe(s1);
    const f1 = stateToString(fullScramble(3, rng(a)).state);
    expect(stateToString(fullScramble(3, rng(a)).state)).toBe(f1);
    expect(stateToString(fullScramble(3, rng(a + 1)).state)).not.toBe(f1);
  });

  it('grades ladders by reach first, efficiency second', () => {
    // The Opus 5.5 run: levels 1-7 in 1, 6, 3, 4, 9, 52, 61 moves.
    expect(ladderScore(ladder(3, 7, [1, 6, 3, 4, 9, 52, 61]))).toBeCloseTo(32.1, 1);
    expect(ladderScore(ladder(3, 7, [1, 2, 3, 4, 5, 6, 7]))).toBeCloseTo(35, 5);
    expect(ladderScore(ladder(3, 0, [], [{ level: 1, status: 'failed', move_count: 3 }]))).toBe(0);
    expect(ladderScore(ladder(2, 11, Array.from({ length: 11 }, (_, i) => i + 1)))).toBe(100);
  });

  it('grades full scrambles by the solve, then moves against the reference', () => {
    const run = (status: string, moves: number): GradedRun => ({ size: 3, challenge: 'scramble', best_level: 0, attempts: [{ level: null, status, move_count: moves }] });
    expect(scrambleScore(run('solved', 20))).toBe(100);
    expect(scrambleScore(run('solved', 40))).toBeCloseTo(90, 5);
    expect(scrambleScore(run('failed', 20))).toBe(0);
  });

  it('averages cubes into tests and tests into the suite; unplayed tests count 0 once it is over', () => {
    const runs = new Map<number, GradedRun>([[0, ladder(2, 11, Array.from({ length: 11 }, (_, i) => i + 1))]]);
    expect(gradeSuite(SUITES.fast, runs, false).score).toBeNull();
    const done = gradeSuite(SUITES.fast, runs, true);
    expect(done.score).toBeCloseTo(100 / 3, 5);
    expect(done.tests.map((t) => t.score)).toEqual([100, 0, 0]);
  });
});
