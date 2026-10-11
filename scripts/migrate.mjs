// Apply db/NNN_*.sql files that have not been applied yet, each in its own
// transaction, recording them in cube_arena.migrations. Never edit an applied file.
//   ADMIN_ENV_FILE=/path/to/admin.env node scripts/migrate.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { adminSql } from './admin-db.mjs';

const sql = adminSql();
try {
  await sql`create schema if not exists cube_arena`;
  await sql`create table if not exists cube_arena.migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`revoke all on cube_arena.migrations from public`;
  const done = new Set((await sql`select name from cube_arena.migrations`).map((r) => r.name));
  const files = readdirSync(new URL('../db/', import.meta.url)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) { console.log(`skip  ${f}`); continue; }
    const text = readFileSync(new URL(`../db/${f}`, import.meta.url), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into cube_arena.migrations (name) values (${f})`;
    });
    console.log(`apply ${f}`);
  }
} finally {
  await sql.end();
}
