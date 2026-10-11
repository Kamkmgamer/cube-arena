import postgres from 'postgres';

// Supabase transaction pooler (port 6543): no prepared statements, few
// connections per function instance. Logs in as `cube_app`, which can only
// touch the cube_arena schema.
//
// Nothing may be pipelined. The pooler hands the server connection back as
// soon as one query finishes outside a transaction, so the reply to a query
// queued behind it on the same connection never arrives, and both sides wait
// forever. postgres.js pipelines onto a busy connection whenever no idle one
// is free, and no setting turns that off without breaking sql.begin. So every
// caller takes a connection to itself with `reserve()` (which only hands out
// idle connections, or waits) through withDb or transaction below.
const g = globalThis as unknown as { __cubeSql?: postgres.Sql };

function pool(): postgres.Sql {
  if (!g.__cubeSql) {
    const url = process.env.CUBE_DATABASE_URL;
    if (!url) throw new Error('CUBE_DATABASE_URL is not set');
    g.__cubeSql = postgres(url, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
      onnotice: () => {},
      debug: process.env.CUBE_DB_DEBUG ? (conn, query) => console.log(`[db ${conn}] ${query.replace(/\s+/g, ' ').slice(0, 110)}`) : undefined,
    });
  }
  return g.__cubeSql;
}

export type Tx = postgres.Sql;

/** Runs fn on a connection of its own. Await each query in turn: never run two at once on it. */
export async function withDb<T>(fn: (sql: Tx) => Promise<T>): Promise<T> {
  const sql = await pool().reserve();
  try {
    return await fn(sql);
  } finally {
    sql.release();
  }
}

/** Runs fn in a transaction on a connection of its own; rolls back if it throws. */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDb(async (sql) => {
    await sql`begin`;
    try {
      const out = await fn(sql);
      await sql`commit`;
      return out;
    } catch (e) {
      await sql`rollback`.catch(() => {});
      throw e;
    }
  });
}

export interface RunRow {
  id: string;
  created_at: Date;
  updated_at: Date;
  board: 'verified' | 'community';
  display_name: string;
  model_name: string;
  tool_use: 'model_only' | 'code' | 'solver';
  client: string | null;
  size: 2 | 3 | 4 | 5;
  mode: 'one_shot' | 'interactive';
  challenge: 'ladder' | 'scramble';
  status: 'active' | 'finished';
  end_reason: string | null;
  lives: number;
  level: number;
  best_level: number;
  attempts: number;
  solves: number;
}

export interface AttemptRow {
  id: string;
  run_id: string;
  seq: number;
  created_at: Date;
  size: 2 | 3 | 4 | 5;
  mode: 'one_shot' | 'interactive';
  level: number | null;
  scramble_kind: 'walk' | 'random_state' | 'random_walk';
  scramble: string | null;
  certified: boolean;
  initial_state: string;
  state: string;
  moves: string[];
  move_count: number;
  move_cap: number;
  turns: number;
  looks: number;
  invalid: number;
  status: 'active' | 'solved' | 'failed' | 'gave_up' | 'timeout' | 'invalid';
  detail: string | null;
  deadline_at: Date;
  finished_at: Date | null;
}

export interface EventRow {
  id: string;
  attempt_id: string;
  at: Date;
  kind: 'start' | 'look' | 'turn' | 'submit' | 'invalid' | 'give_up' | 'timeout';
  moves: string[] | null;
  move_count: number | null;
  solved: boolean | null;
  state: string | null;
  error: string | null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
