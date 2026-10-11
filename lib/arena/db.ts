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
// caller gets a connection to itself through withDb or transaction below.
//
// Nothing is kept between requests either. A serverless instance is paused
// between requests, and an idle socket can be dropped silently meanwhile; the
// next query on it then waits forever (we saw requests hang until the 300 s
// platform limit). The transaction pooler is built for short-lived clients, so
// each operation opens its own connection, closes it after, and is cut off if
// the database has not answered within DEADLINE_MS.
const DEADLINE_MS = 15_000;

function connect(): postgres.Sql {
  const url = process.env.CUBE_DATABASE_URL;
  if (!url) throw new Error('CUBE_DATABASE_URL is not set');
  return postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    ssl: 'require',
    onnotice: () => {},
    debug: process.env.CUBE_DB_DEBUG ? (conn, query) => console.log(`[db ${conn}] ${query.replace(/\s+/g, ' ').slice(0, 110)}`) : undefined,
  });
}

export type Tx = postgres.Sql;

/** Runs fn on a connection of its own. Await each query in turn: never run two at once on it. */
export async function withDb<T>(fn: (sql: Tx) => Promise<T>): Promise<T> {
  const client = connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database did not answer within ${DEADLINE_MS / 1000}s`)), DEADLINE_MS);
  });
  try {
    return await Promise.race([client.reserve().then(fn), deadline]);
  } finally {
    clearTimeout(timer);
    // Closes the socket either way; on a timeout this also abandons the query
    // (an open transaction is rolled back when its connection goes).
    await client.end({ timeout: 0 }).catch(() => {});
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
  /** Hidden by the operator: off every public page. */
  hidden: boolean;
  hidden_reason: string | null;
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
