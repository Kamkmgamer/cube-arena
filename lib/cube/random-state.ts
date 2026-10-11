// Full scrambles. 3x3: a uniformly random legal state (cubejs). Other sizes:
// a long random walk, which is how most big-cube scramblers work.

import Cube from 'cubejs';
import { type CubeState, applyMoves, solvedState, stateFromString } from './engine';
import { FULL_SCRAMBLE_LENGTH, type Rng, randomWalk } from './scramble';

export interface FullScramble {
  state: CubeState;
  /** Move list that produces the state, when it came from a walk. */
  moves: string[] | null;
  kind: 'random_state' | 'random_walk';
}

export function fullScramble(n: number, random: Rng): FullScramble {
  if (n === 3) {
    // cubejs draws from Math.random; lend it ours so a seed gives the same state
    // (suites hand every model the same cubes). Synchronous, so nothing else
    // can run in between.
    const original = Math.random;
    Math.random = random;
    try {
      return { state: stateFromString(Cube.random().asString(), 3), moves: null, kind: 'random_state' };
    } finally {
      Math.random = original;
    }
  }
  const moves = randomWalk(n, FULL_SCRAMBLE_LENGTH[n], random);
  return { state: applyMoves(solvedState(n), n, moves), moves: moves.map((m) => m.token), kind: 'random_walk' };
}
