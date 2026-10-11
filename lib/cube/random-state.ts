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
    return { state: stateFromString(Cube.random().asString(), 3), moves: null, kind: 'random_state' };
  }
  const moves = randomWalk(n, FULL_SCRAMBLE_LENGTH[n], random);
  return { state: applyMoves(solvedState(n), n, moves), moves: moves.map((m) => m.token), kind: 'random_walk' };
}
