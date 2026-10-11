// Operator moderation: list recent runs, hide or unhide one. Only reachable
// with the operator token (app/api/admin/runs/route.ts).

import { clientLabel } from './clients';
import { UUID, withDb } from './db';

export interface AdminRun {
  id: string;
  created_at: Date;
  board: string;
  model_name: string;
  display_name: string;
  tool_use: string;
  size: number;
  mode: string;
  challenge: string;
  status: string;
  best_level: number;
  solves: number;
  via: string;
  hidden: boolean;
  hidden_reason: string | null;
}

const COLUMNS = ['id', 'created_at', 'board', 'model_name', 'display_name', 'tool_use', 'size', 'mode', 'challenge', 'status', 'best_level', 'solves', 'client', 'hidden', 'hidden_reason'];

export async function listRuns(limit: number, onlyHidden: boolean): Promise<AdminRun[]> {
  const rows = await withDb((sql) => sql<(AdminRun & { client: string | null })[]>`
    select ${sql(COLUMNS)} from cube_arena.runs where (${onlyHidden}::boolean = false or hidden) order by created_at desc limit ${limit}`);
  return rows.map(({ client, ...r }) => ({ ...r, via: clientLabel(client) }));
}

/** Changes the run that `id` names (a run id or any of its attempt ids). */
async function change(id: string, set: Partial<Pick<AdminRun, 'hidden' | 'hidden_reason' | 'model_name'>>): Promise<AdminRun | null> {
  if (!UUID.test(id)) return null;
  const [row] = await withDb((sql) => sql<(AdminRun & { client: string | null })[]>`
    update cube_arena.runs set ${sql(set)}
    where id = coalesce((select run_id from cube_arena.attempts where id = ${id}), ${id}::uuid)
    returning ${sql(COLUMNS)}`);
  if (!row) return null;
  const { client, ...r } = row;
  return { ...r, via: clientLabel(client) };
}

export const setHidden = (id: string, hidden: boolean, reason: string | null) => change(id, { hidden, hidden_reason: hidden ? reason : null });

/** Fixes a run's model name, e.g. a vague "GPT-6" once we know it was GPT-6-Astra. */
export const rename = (id: string, modelName: string) => change(id, { model_name: modelName });
