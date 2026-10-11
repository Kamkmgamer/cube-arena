-- Operator moderation: a hidden run disappears from every public page
-- (boards, feeds, live, stats, replays) but stays in the database.
alter table cube_arena.runs add column if not exists hidden boolean not null default false;
alter table cube_arena.runs add column if not exists hidden_reason text;
