// The picture of an attempt: the current state, or the state after a given
// move count (?m=). It is exactly what the model was shown, so it is public.
import { stateFromString } from '@/lib/cube/engine';
import { type AttemptRow, type EventRow, UUID, withDb } from '@/lib/arena/db';
import { atlasPng } from '@/lib/render/png';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response('not found', { status: 404 });
  const mParam = new URL(req.url).searchParams.get('m');
  const found = await withDb(async (sql) => {
    const [a] = await sql<AttemptRow[]>`
      select a.* from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id where a.id = ${id} and not r.hidden`;
    if (!a) return null;
    let state = a.state;
    let moves = a.move_count;
    if (mParam !== null && /^\d+$/.test(mParam) && Number(mParam) !== a.move_count) {
      const [ev] = await sql<EventRow[]>`
        select * from cube_arena.events where attempt_id = ${id} and state is not null and move_count <= ${Number(mParam)}
        order by move_count desc, id desc limit 1`;
      if (ev?.state) {
        state = ev.state;
        moves = ev.move_count ?? 0;
      }
    }
    return { a, state, moves };
  });
  if (!found) return new Response('not found', { status: 404 });
  const { a, state, moves } = found;
  const png = atlasPng(stateFromString(state, a.size), a.size, { caption: a.level ? `level ${a.level}` : 'full scramble', moves });
  const finishedOrPast = a.status !== 'active' || moves !== a.move_count;
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': finishedOrPast ? 'public, max-age=86400, s-maxage=31536000, immutable' : 'no-store',
    },
  });
}
