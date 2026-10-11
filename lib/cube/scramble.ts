// Scrambles: N-move random walks for ladder levels, with an exact check that
// short ones cannot be solved in fewer moves, and full scrambles.

import { FACES, type CubeState, type Face, type Move, applyMoves, isSolved, parseMove, solvedState, turnPermutation } from './engine';

export type Rng = () => number;

/** Seeded PRNG (mulberry32), so a scramble can be regenerated from its seed. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AXIS_OF: Record<Face, number> = { U: 1, D: 1, R: 0, L: 0, F: 2, B: 2 };

/** Moves a scramble may use: outer blocks up to half the cube, all three amounts. */
export function scrambleMoves(n: number): Move[] {
  const out: Move[] = [];
  for (const face of FACES) {
    for (let depth = 1; depth <= Math.max(1, Math.floor(n / 2)); depth++) {
      const base = depth === 1 ? face : `${depth === 2 ? '' : depth}${face}w`;
      for (const sfx of ['', "'", '2']) out.push(parseMove(base + sfx, n));
    }
  }
  return out;
}

const axisOfToken = (t: string) => AXIS_OF[t.replace(/[^URFDLB]/g, '')[0] as Face];

/** Random walk of `length` moves that never turns the same axis twice in a
 * row, so no move cancels or merges with its neighbour. */
export function randomWalk(n: number, length: number, random: Rng): Move[] {
  const pool = scrambleMoves(n);
  const out: Move[] = [];
  let lastAxis = -1;
  while (out.length < length) {
    const m = pool[Math.floor(random() * pool.length)];
    const ax = axisOfToken(m.token);
    if (ax === lastAxis) continue;
    out.push(m);
    lastAxis = ax;
  }
  return out;
}

/** Is the state solvable in at most `depth` outer face turns? Exact,
 * depth-first with standard pruning. On a 2x2 only U, R and F are needed,
 * since the goal ignores whole-cube orientation. */
export function solvableWithin(state: CubeState, n: number, depth: number): boolean {
  if (isSolved(state, n)) return true;
  if (n > 3) throw new Error('exact search is only for 2x2 and 3x3');
  const faces: Face[] = n === 2 ? ['U', 'R', 'F'] : [...FACES];
  const gens = faces.flatMap((f) => ['', "'", '2'].map((s) => ({ face: f, perm: turnPermutation(n, parseMove(f + s, n).turn) })));
  const bufs = Array.from({ length: depth + 1 }, () => new Uint8Array(state.length));
  bufs[0].set(state);
  // Opposite faces commute: only allow them in one order (U before D, R before L, F before B).
  const order: Record<Face, number> = { U: 0, D: 1, R: 0, L: 1, F: 0, B: 1 };
  const dfs = (d: number, lastFace: Face | null): boolean => {
    const cur = bufs[d];
    if (isSolved(cur, n)) return true;
    if (d === depth) return false;
    for (const g of gens) {
      if (lastFace) {
        if (g.face === lastFace) continue;
        if (AXIS_OF[g.face] === AXIS_OF[lastFace] && order[g.face] < order[lastFace]) continue;
      }
      const next = bufs[d + 1];
      for (let j = 0; j < next.length; j++) next[j] = cur[g.perm[j]];
      if (dfs(d + 1, g.face)) return true;
    }
    return false;
  };
  return dfs(0, null);
}

/** Highest level whose exact distance we certify on the fly. */
export const CERTIFY_UP_TO: Record<number, number> = { 2: 8, 3: 6, 4: 0, 5: 0 };

export interface LevelScramble {
  moves: Move[];
  state: CubeState;
  /** True when it is proven that no shorter solution exists. */
  certified: boolean;
}

/** A state exactly `level` moves from solved where we can prove it, otherwise
 * a `level`-move random walk. */
export function levelScramble(n: number, level: number, random: Rng): LevelScramble {
  const certify = level <= (CERTIFY_UP_TO[n] ?? 0);
  for (let tries = 0; tries < 50; tries++) {
    const moves = randomWalk(n, level, random);
    const state = applyMoves(solvedState(n), n, moves);
    if (isSolved(state, n)) continue;
    if (!certify) return { moves, state, certified: false };
    if (!solvableWithin(state, n, level - 1)) return { moves, state, certified: true };
  }
  throw new Error(`could not certify a level ${level} scramble`);
}

/** Lengths for full random-move scrambles (2x2 and 3x3 use random states). */
export const FULL_SCRAMBLE_LENGTH: Record<number, number> = { 2: 25, 3: 25, 4: 40, 5: 60 };
