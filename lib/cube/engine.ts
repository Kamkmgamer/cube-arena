// Exact NxN cube engine, shared by the server (the authority) and the browser
// (replays). No dependencies.
//
// State: one colour id per sticker, faces in U R F D L B order, each face
// row-major as it appears in the standard cube net. This is the Kociemba
// facelet order, so a 3x3 state maps 1:1 onto a 54-letter facelet string.
//
// Geometry: +X right, +Y up, +Z front. Coordinates are doubled so cubie
// centres sit on integers from -(N-1) to N-1 in steps of 2. Every move is a
// quarter-turn rotation of some layers about one axis; its sticker
// permutation is derived from that rotation once and cached.

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];
export type Vec = [number, number, number];
export type CubeState = Uint8Array;

export const SIZES = [2, 3, 4, 5] as const;
export type CubeSize = (typeof SIZES)[number];

/** Outward normal, screen-right and screen-down for each face in the net. */
export const FACE_FRAME: Record<Face, { n: Vec; r: Vec; d: Vec }> = {
  U: { n: [0, 1, 0], r: [1, 0, 0], d: [0, 0, 1] },
  R: { n: [1, 0, 0], r: [0, 0, -1], d: [0, -1, 0] },
  F: { n: [0, 0, 1], r: [1, 0, 0], d: [0, -1, 0] },
  D: { n: [0, -1, 0], r: [1, 0, 0], d: [0, 0, -1] },
  L: { n: [-1, 0, 0], r: [0, 0, 1], d: [0, -1, 0] },
  B: { n: [0, 0, -1], r: [-1, 0, 0], d: [0, -1, 0] },
};

/** Axis index and sign of each face's normal. */
const FACE_AXIS: Record<Face, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  U: { axis: 1, sign: 1 },
  D: { axis: 1, sign: -1 },
  R: { axis: 0, sign: 1 },
  L: { axis: 0, sign: -1 },
  F: { axis: 2, sign: 1 },
  B: { axis: 2, sign: -1 },
};

export interface Sticker {
  face: Face;
  row: number;
  col: number;
  /** Doubled position of the cubie this sticker sits on. */
  pos: Vec;
  /** Outward normal of the sticker. */
  normal: Vec;
}

const stickerCache = new Map<number, Sticker[]>();

/** All 6*N*N stickers in state order. */
export function stickers(n: number): Sticker[] {
  let s = stickerCache.get(n);
  if (s) return s;
  s = [];
  for (const face of FACES) {
    const { n: nrm, r, d } = FACE_FRAME[face];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const a = 2 * col - (n - 1);
        const b = 2 * row - (n - 1);
        const pos: Vec = [0, 1, 2].map((k) => nrm[k] * (n - 1) + r[k] * a + d[k] * b) as Vec;
        s.push({ face, row, col, pos, normal: [...nrm] as Vec });
      }
    }
  }
  stickerCache.set(n, s);
  return s;
}

export function solvedState(n: number): CubeState {
  const s = new Uint8Array(6 * n * n);
  for (let f = 0; f < 6; f++) s.fill(f, f * n * n, (f + 1) * n * n);
  return s;
}

/** Every face a single colour. Only legal moves ever produce states, so this is
 * exactly "solved in some whole-cube orientation". */
export function isSolved(state: CubeState, n: number): boolean {
  const nn = n * n;
  for (let f = 0; f < 6; f++) {
    const c = state[f * nn];
    for (let i = 1; i < nn; i++) if (state[f * nn + i] !== c) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Moves

/** A layer rotation: `quarter` counter-clockwise quarter turns about +axis
 * (right-hand rule) of the layers whose coordinate is in `layers`. */
export interface Turn {
  axis: 0 | 1 | 2;
  layers: number[];
  quarter: 1 | 2 | 3;
}

export interface Move {
  /** Canonical spelling, e.g. "R", "R'", "Rw2", "3Rw'", "2R", "M", "x'". */
  token: string;
  kind: 'face' | 'wide' | 'slice' | 'rotation';
  turn: Turn;
  /** Counted moves: 1 for any layer turn, 0 for a whole-cube rotation. */
  cost: 0 | 1;
}

function rotate(v: Vec, axis: 0 | 1 | 2, quarter: number): Vec {
  let [x, y, z] = v;
  for (let q = 0; q < quarter; q++) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [x, z] = [z, -x];
    else [x, y] = [-y, x];
  }
  return [x, y, z];
}

const permCache = new Map<string, Int32Array>();
const keyOf = (p: Vec, nm: Vec) => `${p[0]},${p[1]},${p[2]}|${nm[0]},${nm[1]},${nm[2]}`;
const indexCache = new Map<number, Map<string, number>>();

function stickerIndex(n: number): Map<string, number> {
  let m = indexCache.get(n);
  if (m) return m;
  m = new Map();
  stickers(n).forEach((s, i) => m!.set(keyOf(s.pos, s.normal), i));
  indexCache.set(n, m);
  return m;
}

/** src[j] = the sticker index whose colour lands on j after the turn. */
export function turnPermutation(n: number, turn: Turn): Int32Array {
  const key = `${n}:${turn.axis}:${turn.layers.join(',')}:${turn.quarter}`;
  let src = permCache.get(key);
  if (src) return src;
  const all = stickers(n);
  const index = stickerIndex(n);
  src = new Int32Array(all.length);
  for (let i = 0; i < all.length; i++) src[i] = i;
  const layerSet = new Set(turn.layers);
  all.forEach((s, i) => {
    if (!layerSet.has(s.pos[turn.axis])) return;
    const j = index.get(keyOf(rotate(s.pos, turn.axis, turn.quarter), rotate(s.normal, turn.axis, turn.quarter)));
    if (j === undefined) throw new Error('rotation left the cube');
    src![j] = i;
  });
  permCache.set(key, src);
  return src;
}

export function applyTurn(state: CubeState, n: number, turn: Turn): CubeState {
  const src = turnPermutation(n, turn);
  const out = new Uint8Array(state.length);
  for (let j = 0; j < out.length; j++) out[j] = state[src[j]];
  return out;
}

/** Coordinate of the k-th layer (1-based) counted inwards from a face. */
const layerCoord = (n: number, sign: number, depth: number) => sign * (n - 1 - 2 * (depth - 1));

function faceTurn(n: number, face: Face, from: number, to: number, amount: 1 | 2 | 3): Turn {
  const { axis, sign } = FACE_AXIS[face];
  const layers: number[] = [];
  for (let k = from; k <= to; k++) layers.push(layerCoord(n, sign, k));
  // Clockwise seen from outside the face = -90 degrees about its outward normal.
  // About +axis that is 3 quarters for a positive face, 1 for a negative one.
  const cw = sign === 1 ? 3 : 1;
  return { axis, layers, quarter: (((cw * amount) % 4) as 1 | 2 | 3) };
}

const SUFFIX_AMOUNT: Record<string, 1 | 2 | 3> = { '': 1, "'": 3, '2': 2, "2'": 2 };
const suffixOf = (amount: 1 | 2 | 3) => (amount === 1 ? '' : amount === 2 ? '2' : "'");

export class MoveError extends Error {
  constructor(
    message: string,
    readonly token: string,
  ) {
    super(message);
  }
}

/** Parse one move token for an NxN cube. */
export function parseMove(raw: string, n: number): Move {
  const tok = raw.replace(/[’′‘`´]/g, "'");
  let m = /^([xyz])(2'|2|'|)$/.exec(tok);
  if (m) {
    const axisFace: Face = m[1] === 'x' ? 'R' : m[1] === 'y' ? 'U' : 'F';
    const amount = SUFFIX_AMOUNT[m[2]];
    const turn = faceTurn(n, axisFace, 1, n, amount);
    return { token: m[1] + suffixOf(amount), kind: 'rotation', turn, cost: 0 };
  }
  m = /^([MES])(2'|2|'|)$/.exec(tok);
  if (m) {
    if (n % 2 === 0) throw new MoveError(`${tok}: M, E and S need a middle layer, so they only work on odd-sized cubes`, raw);
    // M follows L, E follows D, S follows F.
    const follow: Face = m[1] === 'M' ? 'L' : m[1] === 'E' ? 'D' : 'F';
    const mid = (n + 1) / 2;
    const amount = SUFFIX_AMOUNT[m[2]];
    return { token: m[1] + suffixOf(amount), kind: 'slice', turn: faceTurn(n, follow, mid, mid, amount), cost: 1 };
  }
  m = /^(\d+)?([URFDLB])(w?)(2'|2|'|)$/.exec(tok);
  if (m) {
    const face = m[2] as Face;
    const amount = SUFFIX_AMOUNT[m[4]];
    const sfx = suffixOf(amount);
    const depth = m[1] === undefined ? undefined : Number(m[1]);
    if (m[3] === 'w') {
      const k = depth ?? 2;
      if (n < 3) throw new MoveError(`${tok}: wide turns need a cube of 3x3 or larger`, raw);
      if (k < 2 || k > n - 1) throw new MoveError(`${tok}: wide turns on a ${n}x${n} cover 2 to ${n - 1} layers`, raw);
      return { token: (k === 2 ? '' : String(k)) + face + 'w' + sfx, kind: 'wide', turn: faceTurn(n, face, 1, k, amount), cost: 1 };
    }
    if (depth === undefined) return { token: face + sfx, kind: 'face', turn: faceTurn(n, face, 1, 1, amount), cost: 1 };
    if (depth < 2 || depth > n - 1) throw new MoveError(`${tok}: inner slices on a ${n}x${n} are layers 2 to ${n - 1}`, raw);
    return { token: depth + face + sfx, kind: 'slice', turn: faceTurn(n, face, depth, depth, amount), cost: 1 };
  }
  throw new MoveError(`${raw}: not a move. Use U R F D L B with ' or 2 (e.g. R, U', F2); see the rules`, raw);
}

const TOKEN_SCAN = /\d*[URFDLB]w?(?:2'|2|'|[’′‘`´])?|[MESxyz](?:2'|2|'|[’′‘`´])?/y;

/** Split a move sequence written as text ("R U R' U'", "R,U2", "RUR'U'") or as a list. */
export function tokenize(input: string | string[]): string[] {
  const chunks = (Array.isArray(input) ? input : [input])
    .flatMap((s) => String(s).split(/[\s,;]+/))
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const chunk of chunks) {
    if (/^(\d+)?[URFDLB]w?(2'|2|'|[’′‘`´])?$|^[MESxyz](2'|2|'|[’′‘`´])?$/.test(chunk)) {
      out.push(chunk);
      continue;
    }
    // Moves written without spaces: scan greedily, fail on any leftover.
    TOKEN_SCAN.lastIndex = 0;
    let i = 0;
    const part: string[] = [];
    while (i < chunk.length) {
      TOKEN_SCAN.lastIndex = i;
      const m = TOKEN_SCAN.exec(chunk);
      if (!m || m[0].length === 0) throw new MoveError(`could not read "${chunk}" as moves`, chunk);
      part.push(m[0]);
      i += m[0].length;
    }
    out.push(...part);
  }
  return out;
}

export function parseMoves(input: string | string[], n: number): Move[] {
  return tokenize(input).map((t) => parseMove(t, n));
}

export function applyMoves(state: CubeState, n: number, moves: Move[]): CubeState {
  let s = state;
  for (const m of moves) s = applyTurn(s, n, m.turn);
  return s;
}

export function invertMove(move: Move, n: number): Move {
  const t = move.token;
  const base = t.replace(/(2|')$/, '');
  const inv = t.endsWith('2') ? t : t.endsWith("'") ? base : base + "'";
  return parseMove(inv, n);
}

export const moveCost = (moves: Move[]) => moves.reduce((a, m) => a + m.cost, 0);

// ---------------------------------------------------------------------------
// Serialisation: one letter per sticker, the colour of the face it belongs to
// when solved (U R F D L B). Same as a Kociemba facelet string on a 3x3.

export const stateToString = (s: CubeState) => Array.from(s, (c) => FACES[c]).join('');

export function stateFromString(text: string, n: number): CubeState {
  if (text.length !== 6 * n * n) throw new Error(`state for ${n}x${n} must have ${6 * n * n} stickers`);
  return Uint8Array.from(text, (ch) => {
    const i = FACES.indexOf(ch as Face);
    if (i < 0) throw new Error(`bad sticker "${ch}"`);
    return i;
  });
}
