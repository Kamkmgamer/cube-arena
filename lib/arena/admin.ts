// Operator moderation: list recent runs, hide or unhide one. Only reachable
// with the operator token (app/api/admin/runs/route.ts).

import { clientLabel } from './clients';
import { type SuiteRow, type Usage, UUID, transaction, withDb } from './db';
import { gradeSuites } from './suite-data';
import type { SuiteGrade } from './suites';

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
  suite_id: string | null;
  suite_slot: number | null;
}

const COLUMNS = [
  'id', 'created_at', 'board', 'model_name', 'display_name', 'tool_use', 'size', 'mode', 'challenge', 'status', 'best_level', 'solves', 'client',
  'hidden', 'hidden_reason', 'suite_id', 'suite_slot',
];

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

/**
 * Hides or unhides a run (by run or attempt id) or a whole suite (by suite id).
 * Part of a suite hides all of it: a suite score without some of its tests
 * would be wrong.
 */
export async function setHidden(id: string, hidden: boolean, reason: string | null): Promise<AdminRun | null> {
  if (!UUID.test(id)) return null;
  const why = hidden ? reason : null;
  const suiteId = await withDb(async (sql) => {
    const [row] = await sql<{ suite_id: string }[]>`
      select id as suite_id from cube_arena.suites where id = ${id}
      union all
      select suite_id from cube_arena.runs
      where suite_id is not null and id = coalesce((select run_id from cube_arena.attempts where id = ${id}), ${id}::uuid)
      limit 1`;
    return row?.suite_id ?? null;
  });
  if (!suiteId) return change(id, { hidden, hidden_reason: why });
  await transaction(async (tx) => {
    await tx`update cube_arena.suites set hidden = ${hidden}, hidden_reason = ${why} where id = ${suiteId}`;
    await tx`update cube_arena.runs set hidden = ${hidden}, hidden_reason = ${why} where suite_id = ${suiteId}`;
  });
  const [first] = await withDb((sql) => sql<(AdminRun & { client: string | null })[]>`
    select ${sql(COLUMNS)} from cube_arena.runs where suite_id = ${suiteId} order by suite_slot limit 1`);
  if (!first) return null;
  const { client, ...r } = first;
  return { ...r, via: clientLabel(client) };
}

/** Records the tokens and cost the runner measured for a run. */
export async function setUsage(id: string, usage: Usage): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await withDb((sql) => sql`update cube_arena.runs set usage = ${sql.json(usage as Record<string, number>)} where id = ${id} returning id`);
  return rows.length > 0;
}

export interface AdminSuite extends SuiteRow {
  grade: SuiteGrade | null;
  /** Slots that have a run (started or finished). */
  slots_played?: number[];
}

export async function listSuites(limit: number): Promise<AdminSuite[]> {
  return withDb(async (sql) => {
    const suites = await sql<SuiteRow[]>`select * from cube_arena.suites order by created_at desc limit ${limit}`;
    const grades = await gradeSuites(sql, suites);
    return suites.map((s) => ({ ...s, grade: grades.get(s.id) ?? null }));
  });
}

export async function getSuite(id: string): Promise<AdminSuite | null> {
  if (!UUID.test(id)) return null;
  return withDb(async (sql) => {
    const [suite] = await sql<SuiteRow[]>`select * from cube_arena.suites where id = ${id}`;
    if (!suite) return null;
    const slots = await sql<{ suite_slot: number }[]>`select suite_slot from cube_arena.runs where suite_id = ${id} and status = 'finished'`;
    return { ...suite, grade: (await gradeSuites(sql, [suite])).get(suite.id) ?? null, slots_played: slots.map((r) => r.suite_slot) };
  });
}

/** Fixes a run's model name, e.g. a vague "GPT-6" once we know it was GPT-6-Astra. */
export const rename = (id: string, modelName: string) => change(id, { model_name: modelName });
