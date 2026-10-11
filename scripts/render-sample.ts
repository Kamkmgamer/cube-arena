import { mkdirSync, writeFileSync } from 'node:fs';
import { applyMoves, parseMoves, solvedState } from '../lib/cube/engine';
import { atlasPng } from '../lib/render/png';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const [n, alg] of [[3, ''], [3, "R U R' U'"], [2, "R U F'"], [4, "Rw U2 F' L D2 Bw"], [5, "R 2U Fw' L D2 3Rw B"]] as const) {
  const s = applyMoves(solvedState(n), n, parseMoves(alg, n));
  const png = atlasPng(s, n, { moves: 0, caption: alg ? `sample: ${alg}` : 'solved' });
  writeFileSync(`${out}/atlas-${n}-${alg.replace(/\W+/g, '_') || 'solved'}.png`, png);
}
console.log('ok');
