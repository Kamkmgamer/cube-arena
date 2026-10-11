-- Cube Arena (cube.krnl.studio).
--
-- Lives in the KRNL OS Supabase project beside krnl.studio's `studio` schema
-- and the games site's `games` schema, fully separate from both. The app logs
-- in as `cube_app`, which can read and write only this schema's tables and
-- has no access to any other schema. Tables have row level security with
-- policies for `cube_app` only, so nothing reaches them through the Supabase
-- REST API.
--
-- Applied by scripts/migrate.mjs as the postgres user. The role's password is
-- set separately (scripts/set-app-password.mjs), never in this file.

create schema if not exists cube_arena;
revoke all on schema cube_arena from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema cube_arena from anon, authenticated';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'cube_app') then
    create role cube_app login noinherit nocreatedb nocreaterole connection limit 20;
  end if;
end $$;

-- A run is one go at a challenge: a ladder (climb levels until out of lives)
-- or a single full scramble.
create table if not exists cube_arena.runs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  board          text not null check (board in ('verified', 'community')),
  display_name   text not null check (char_length(display_name) between 2 and 32),
  model_name     text not null check (char_length(model_name) between 1 and 64),
  tool_use       text not null check (tool_use in ('model_only', 'code', 'solver')),
  client         text,
  size           int  not null check (size between 2 and 5),
  mode           text not null check (mode in ('one_shot', 'interactive')),
  challenge      text not null check (challenge in ('ladder', 'scramble')),
  status         text not null default 'active' check (status in ('active', 'finished')),
  end_reason     text,
  lives          int  not null default 0,
  level          int  not null default 0,
  best_level     int  not null default 0,
  attempts       int  not null default 0,
  solves         int  not null default 0,
  ip_hash        text
);
create index if not exists runs_board_idx  on cube_arena.runs (board, size, mode, challenge, tool_use);
create index if not exists runs_recent_idx on cube_arena.runs (created_at desc);
create index if not exists runs_ip_idx     on cube_arena.runs (ip_hash, created_at desc);

-- One cube: a scrambled start state and everything done to it.
create table if not exists cube_arena.attempts (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references cube_arena.runs (id) on delete cascade,
  seq            int  not null,
  created_at     timestamptz not null default now(),
  size           int  not null,
  mode           text not null,
  level          int,
  scramble_kind  text not null check (scramble_kind in ('walk', 'random_state', 'random_walk')),
  scramble       text,
  certified      boolean not null default false,
  initial_state  text not null,
  state          text not null,
  moves          text[] not null default '{}',
  move_count     int  not null default 0,
  move_cap       int  not null,
  turns          int  not null default 0,
  looks          int  not null default 0,
  invalid        int  not null default 0,
  status         text not null default 'active'
                 check (status in ('active', 'solved', 'failed', 'gave_up', 'timeout', 'invalid')),
  detail         text,
  deadline_at    timestamptz not null,
  finished_at    timestamptz,
  unique (run_id, seq)
);
create index if not exists attempts_status_idx on cube_arena.attempts (status, created_at desc);
create index if not exists attempts_run_idx    on cube_arena.attempts (run_id, seq);

-- Every request against an attempt, with the state after it (what the model
-- was shown next), so replays can show exactly what the model saw.
create table if not exists cube_arena.events (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null references cube_arena.attempts (id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('start', 'look', 'turn', 'submit', 'invalid', 'give_up', 'timeout')),
  moves       text[],
  move_count  int,
  solved      boolean,
  state       text,
  error       text
);
create index if not exists events_attempt_idx on cube_arena.events (attempt_id, id);

alter table cube_arena.runs     enable row level security;
alter table cube_arena.attempts enable row level security;
alter table cube_arena.events   enable row level security;
drop policy if exists cube_app_all on cube_arena.runs;
drop policy if exists cube_app_all on cube_arena.attempts;
drop policy if exists cube_app_all on cube_arena.events;
create policy cube_app_all on cube_arena.runs     for all to cube_app using (true) with check (true);
create policy cube_app_all on cube_arena.attempts for all to cube_app using (true) with check (true);
create policy cube_app_all on cube_arena.events   for all to cube_app using (true) with check (true);

grant usage on schema cube_arena to cube_app;
grant select, insert, update on cube_arena.runs, cube_arena.attempts, cube_arena.events to cube_app;
alter role cube_app set search_path = cube_arena;
alter role cube_app set statement_timeout = '8s';
