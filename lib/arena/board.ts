// Read-only queries for the site: leaderboards, stats, feeds, replays.
//
// The database is shared with other KRNL apps, so page reads are cached for a
// few seconds across all servers: a traffic spike costs a handful of queries,
// not one per visitor. Cached values round-trip through JSON, so dates arrive
// as strings (the UI always wraps them in new Date()).

import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { type AttemptRow, type EventRow, type RunRow, UUID, withDb } from './db';
import type { Board, Challenge, Mode, Size, ToolUse } from './rules';

export interface BoardFilter {
  board: Board;
  size: Size;
  mode: Mode;
  challenge: Challenge;
  toolUse: ToolUse;
}

export interface LadderRow {
  model_name: string;
  display_name: string;
  best: number;
  avg_best: number;
  runs: number;
  last: Date;
  best_attempt: string | null;
}

async function ladderBoardQuery(f: BoardFilter, limit = 100): Promise<LadderRow[]> {
  return withDb((sql) => sql<LadderRow[]>`
    with r as (
      select * from cube_arena.runs
      where challenge = 'ladder' and board = ${f.board} and size = ${f.size} and mode = ${f.mode} and tool_use = ${f.toolUse}
    ), g as (
      select model_name, display_name, max(best_level)::int as best, round(avg(best_level), 1)::float as avg_best,
             count(*)::int as runs, max(updated_at) as last
      from r group by model_name, display_name
    )
    select g.*, (
      select a.id from r join cube_arena.attempts a on a.run_id = r.id
      where r.model_name = g.model_name and r.display_name = g.display_name and a.status = 'solved'
      order by a.level desc nulls last, a.move_count asc limit 1
    ) as best_attempt
    from g order by best desc, avg_best desc, runs desc, last desc limit ${limit}`);
}

export interface ScrambleRow {
  model_name: string;
  display_name: string;
  runs: number;
  solved: number;
  median_moves: number | null;
  last: Date;
  best_attempt: string | null;
}

async function scrambleBoardQuery(f: BoardFilter, limit = 100): Promise<ScrambleRow[]> {
  return withDb((sql) => sql<ScrambleRow[]>`
    with x as (
      select r.model_name, r.display_name, r.updated_at, a.id, a.status, a.move_count
      from cube_arena.runs r join cube_arena.attempts a on a.run_id = r.id
      where r.challenge = 'scramble' and r.status = 'finished' and r.board = ${f.board} and r.size = ${f.size}
        and r.mode = ${f.mode} and r.tool_use = ${f.toolUse}
    )
    select model_name, display_name, count(*)::int as runs, count(*) filter (where status = 'solved')::int as solved,
           (percentile_cont(0.5) within group (order by move_count) filter (where status = 'solved'))::float as median_moves,
           max(updated_at) as last,
           (array_agg(id order by move_count) filter (where status = 'solved'))[1] as best_attempt
    from x group by model_name, display_name
    order by (count(*) filter (where status = 'solved'))::float / count(*) desc, solved desc, median_moves asc nulls last
    limit ${limit}`);
}

export interface Stats {
  runs: number;
  solves: number;
  models: number;
  best3: number;
  live: number;
}

async function statsQuery(): Promise<Stats> {
  const [s] = await withDb((sql) => sql<Stats[]>`
    select (select count(*) from cube_arena.runs)::int as runs,
           (select count(*) from cube_arena.attempts where status = 'solved')::int as solves,
           (select count(distinct lower(model_name)) from cube_arena.runs)::int as models,
           coalesce((select max(best_level) from cube_arena.runs where size = 3 and challenge = 'ladder'), 0)::int as best3,
           (select count(*) from cube_arena.attempts where status = 'active' and deadline_at > now())::int as live`);
  return s;
}

export interface FeedItem {
  id: string;
  status: AttemptRow['status'];
  size: number;
  mode: Mode;
  level: number | null;
  move_count: number;
  finished_at: Date | null;
  created_at: Date;
  model_name: string;
  display_name: string;
  board: Board;
  tool_use: ToolUse;
  challenge: Challenge;
}

async function recentFinishedQuery(limit = 12): Promise<FeedItem[]> {
  return withDb((sql) => sql<FeedItem[]>`
    select a.id, a.status, a.size, a.mode, a.level, a.move_count, a.finished_at, a.created_at,
           r.model_name, r.display_name, r.board, r.tool_use, r.challenge
    from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
    where a.status in ('solved', 'failed', 'invalid')
    order by a.finished_at desc nulls last limit ${limit}`);
}

async function liveAttemptsQuery(limit = 24): Promise<FeedItem[]> {
  return withDb((sql) => sql<FeedItem[]>`
    select a.id, a.status, a.size, a.mode, a.level, a.move_count, a.finished_at, a.created_at,
           r.model_name, r.display_name, r.board, r.tool_use, r.challenge
    from cube_arena.attempts a join cube_arena.runs r on r.id = a.run_id
    where a.status = 'active' and a.deadline_at > now()
    order by a.created_at desc limit ${limit}`);
}

export interface Replay {
  attempt: AttemptRow;
  run: RunRow;
  events: Pick<EventRow, 'kind' | 'move_count' | 'solved' | 'at' | 'error' | 'moves'>[];
  /** Other attempts in the same run, for navigation. */
  siblings: Pick<AttemptRow, 'id' | 'seq' | 'level' | 'status'>[];
}

async function replayQuery(id: string): Promise<Replay | null> {
  if (!UUID.test(id)) return null;
  return withDb(async (sql) => {
    const [attempt] = await sql<AttemptRow[]>`select * from cube_arena.attempts where id = ${id}`;
    if (!attempt) return null;
    const [run] = await sql<RunRow[]>`select * from cube_arena.runs where id = ${attempt.run_id}`;
    const events = await sql<Replay['events']>`
      select kind, move_count, solved, at, error, moves from cube_arena.events
      where attempt_id = ${id} and kind <> 'look' order by id`;
    const siblings = await sql<Replay['siblings']>`
      select id, seq, level, status from cube_arena.attempts where run_id = ${run.id} order by seq`;
    return { attempt, run, events, siblings };
  });
}

export const ladderBoard = unstable_cache(ladderBoardQuery, ['cube-arena', 'ladderBoard'], { revalidate: 20 });
export const scrambleBoard = unstable_cache(scrambleBoardQuery, ['cube-arena', 'scrambleBoard'], { revalidate: 20 });
export const stats = unstable_cache(statsQuery, ['cube-arena', 'stats'], { revalidate: 20 });
export const recentFinished = unstable_cache(recentFinishedQuery, ['cube-arena', 'recentFinished'], { revalidate: 10 });
export const liveAttempts = unstable_cache(liveAttemptsQuery, ['cube-arena', 'liveAttempts'], { revalidate: 3 });

/** Deduped per request (metadata and page both ask). Not cached across requests: live attempts change. */
export const replay = cache(replayQuery);
