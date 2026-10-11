import Cube from 'cubejs';
import { describe, expect, it } from 'vitest';
import {
  type CubeState, applyMoves, isSolved, parseMove, parseMoves, solvedState, stateToString, stickers, tokenize,
} from '../lib/cube/engine';
import { levelScramble, randomWalk, rng, solvableWithin } from '../lib/cube/scramble';

const run = (n: number, alg: string, from: CubeState = solvedState(n)) => applyMoves(from, n, parseMoves(alg, n));
const same = (a: CubeState, b: CubeState) => stateToString(a) === stateToString(b);

function allTokens(n: number): string[] {
  const t: string[] = [];
  for (const f of 'URFDLB') {
    t.push(f);
    for (let k = 2; k <= n - 1; k++) t.push(`${k}${f}`, `${k}${f}w`);
    if (n >= 3) t.push(`${f}w`);
  }
  t.push('x', 'y', 'z');
  if (n % 2 === 1) t.push('M', 'E', 'S');
  return t;
}

describe('geometry', () => {
  it('has 6*N*N distinct stickers', () => {
    for (const n of [2, 3, 4, 5]) {
      const keys = new Set(stickers(n).map((s) => `${s.pos}|${s.normal}`));
      expect(keys.size).toBe(6 * n * n);
    }
  });
});

describe('move algebra, every size', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`${n}x${n}: quarter turn x4, half turn x2 and X X' are identities`, () => {
      for (const t of allTokens(n)) {
        expect(isSolved(run(n, `${t} ${t} ${t} ${t}`), n), t).toBe(true);
        const scrambled = run(n, 'R U F2 L\' D B');
        expect(same(run(n, `${t}2 ${t}2`, scrambled), scrambled), `${t}2`).toBe(true);
        expect(same(run(n, `${t} ${t}'`, scrambled), scrambled), `${t}'`).toBe(true);
      }
    });
    it(`${n}x${n}: a random walk followed by its inverse solves`, () => {
      const r = rng(n * 7919);
      for (let i = 0; i < 20; i++) {
        const walk = randomWalk(n, 30, r);
        const back = [...walk].reverse().map((m) => {
          const t = m.token;
          return t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : t + "'";
        });
        expect(isSolved(run(n, back.join(' '), applyMoves(solvedState(n), n, walk)), n)).toBe(true);
      }
    });
    it(`${n}x${n}: whole-cube rotations keep a solved cube solved`, () => {
      expect(isSolved(run(n, "x y z' x2 y'"), n)).toBe(true);
      expect(isSolved(run(n, 'x R'), n)).toBe(false);
    });
  }
});

describe('3x3 matches cubejs (independent implementation)', () => {
  it('facelet strings agree on random sequences', () => {
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const alg = randomWalk(3, 1 + Math.floor(r() * 30), r).map((m) => m.token).join(' ');
      const ref = new Cube().move(alg).asString();
      expect(stateToString(run(3, alg)), alg).toBe(ref);
    }
  });
  it('known orders: R U is 105, sexy move is 6', () => {
    const order = (alg: string) => {
      let s = run(3, alg);
      let k = 1;
      while (!isSolved(s, 3)) { s = run(3, alg, s); k++; }
      return k;
    };
    expect(order('R U')).toBe(105);
    expect(order("R U R' U'")).toBe(6);
  });
});

describe('notation identities', () => {
  const eq = (n: number, a: string, b: string) => expect(stateToString(run(n, a)), `${a} = ${b}`).toBe(stateToString(run(n, b)));
  it('3x3 slices, wides, rotations', () => {
    eq(3, "Rw", "R M'");
    eq(3, 'M', "R L' x'");
    eq(3, 'E', "U D' y'");
    eq(3, 'S', "F' B z");
    eq(3, 'x', "R M' L'");
    eq(3, 'y', "U E' D'");
    eq(3, 'z', "F S B'");
  });
  it('big cubes', () => {
    eq(4, 'Rw', 'R 2R');
    eq(4, '3Rw', 'R 2R 3R');
    eq(4, 'x', "R 2R 3R L'");
    eq(4, 'Uw2', 'U2 2U2');
    eq(5, 'M', '3L');
    eq(5, '3Rw', 'R 2R 3R');
    eq(5, 'x', "R 2R 3R 4R L'");
  });
});

describe('parsing', () => {
  it('accepts common spellings', () => {
    expect(tokenize("RUR'U'")).toEqual(['R', 'U', "R'", "U'"]);
    expect(tokenize(['R', "U2'", 'F’'])).toEqual(['R', "U2'", 'F’']);
    expect(parseMove("U2'", 3).token).toBe('U2');
    expect(parseMove('F’', 3).token).toBe("F'");
    expect(parseMove('2Rw', 4).token).toBe('Rw');
    expect(parseMove('x', 3).cost).toBe(0);
  });
  it('rejects bad moves with a reason', () => {
    expect(() => parseMove('Q', 3)).toThrow(/not a move/);
    expect(() => parseMove('M', 4)).toThrow(/odd-sized/);
    expect(() => parseMove('4Rw', 4)).toThrow(/2 to 3 layers/);
    expect(() => parseMove('Rw', 2)).toThrow(/3x3 or larger/);
    expect(() => tokenize('R U hello')).toThrow();
  });
});

describe('ladder scrambles', () => {
  it('certified levels have no shorter solution', () => {
    const r = rng(7);
    for (const [n, maxLevel] of [[3, 5], [2, 6]] as const) {
      for (let level = 1; level <= maxLevel; level++) {
        const sc = levelScramble(n, level, r);
        expect(sc.certified).toBe(true);
        expect(solvableWithin(sc.state, n, level)).toBe(true);
        expect(solvableWithin(sc.state, n, level - 1)).toBe(false);
      }
    }
  });
});
