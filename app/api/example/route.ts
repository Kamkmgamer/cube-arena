// Example pictures for the rules page: a solved 3x3, and after a move.
import { applyMoves, parseMoves, solvedState } from '@/lib/cube/engine';
import { atlasPng } from '@/lib/render/png';

export async function GET(req: Request) {
  const move = new URL(req.url).searchParams.get('move');
  const alg = move && /^[URFDLB]['2]?$/.test(move) ? move : '';
  const s = applyMoves(solvedState(3), 3, parseMoves(alg || [], 3));
  const png = atlasPng(s, 3, { caption: alg ? `example: after ${alg}` : 'example: solved', moves: alg ? 1 : 0 });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}
