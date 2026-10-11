// Operator-only moderation API (Authorization: Bearer CUBE_OPERATOR_TOKEN).
//   GET  /api/admin/runs?limit=50&hidden=1      recent runs (or only hidden ones)
//   POST /api/admin/runs {id, hidden, reason}   hide or unhide a run (run id or attempt id)
//   POST /api/admin/runs {id, stop: true, reason} end an active run now, as a timeout
//   POST /api/admin/runs {id, model_name}        fix a run's model name
//   POST /api/admin/runs {id, usage}             record the tokens and cost the runner measured
// Hiding a run that belongs to a suite (or passing a suite id) hides the whole suite.
// scripts/moderate.mjs wraps both. Boards refresh within ~20 s (their cache).
import { listRuns, rename, setHidden, setUsage } from '@/lib/arena/admin';
import { tokenMatches } from '@/lib/arena/mcp';
import { stopRun } from '@/lib/arena/service';

export const dynamic = 'force-dynamic';

const authorized = (req: Request) => tokenMatches((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''), process.env.CUBE_OPERATOR_TOKEN);
const deny = () => Response.json({ error: 'not allowed' }, { status: 401 });

export async function GET(req: Request) {
  if (!authorized(req)) return deny();
  const q = new URL(req.url).searchParams;
  const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 50));
  return Response.json({ runs: await listRuns(limit, q.get('hidden') === '1') }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!authorized(req)) return deny();
  const body = (await req.json().catch(() => null)) as { id?: unknown; hidden?: unknown; stop?: unknown; reason?: unknown; model_name?: unknown; usage?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null;
  if (body?.stop === true) return Response.json({ stopped: await stopRun(id, reason ?? 'stopped by the operator') });
  if (body?.usage && typeof body.usage === 'object') {
    const u = body.usage as Record<string, unknown>;
    const usage = Object.fromEntries(
      ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'cost_usd'].flatMap((k) => (Number.isFinite(u[k]) ? [[k, Number(u[k])]] : [])),
    );
    return Response.json({ recorded: await setUsage(id, usage) });
  }
  const name = typeof body?.model_name === 'string' ? body.model_name.trim().slice(0, 80) : '';
  const run = name ? await rename(id, name) : await setHidden(id, body?.hidden !== false, reason);
  if (!run) return Response.json({ error: 'no run or attempt with that id' }, { status: 404 });
  return Response.json({ run });
}
