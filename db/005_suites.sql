-- Suites: Fast and Thorough, fixed sets of tests played one after another and
-- graded together. Each test is an ordinary run that points at its suite.
create table if not exists cube_arena.suites (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz,
  kind          text not null check (kind in ('fast', 'thorough')),
  version       text not null,
  board         text not null check (board in ('verified', 'community')),
  display_name  text not null check (char_length(display_name) between 2 and 32),
  -- The name on the boards, e.g. "GPT-6-Luna (max)".
  model_name    text not null check (char_length(model_name) between 1 and 64),
  -- Verified only, from the runner: the model without effort, its CLI id, the effort, the CLI.
  model         text,
  model_id      text,
  effort        text,
  agent         text,
  client        text,
  ip_hash       text,
  status        text not null default 'active' check (status in ('active', 'finished')),
  hidden        boolean not null default false,
  hidden_reason text
);
create index if not exists suites_board_idx on cube_arena.suites (board, kind, version, status);

alter table cube_arena.runs add column if not exists suite_id uuid references cube_arena.suites (id) on delete cascade;
alter table cube_arena.runs add column if not exists suite_slot int;
-- A time budget for the whole run (suite tests); attempts never outlast it.
alter table cube_arena.runs add column if not exists deadline_at timestamptz;
-- Tokens and cost the runner measured for this run (Verified only).
alter table cube_arena.runs add column if not exists usage jsonb;
create unique index if not exists runs_suite_slot_idx on cube_arena.runs (suite_id, suite_slot) where suite_id is not null;

alter table cube_arena.suites enable row level security;
drop policy if exists cube_app_all on cube_arena.suites;
create policy cube_app_all on cube_arena.suites for all to cube_app using (true) with check (true);
grant select, insert, update on cube_arena.suites to cube_app;
