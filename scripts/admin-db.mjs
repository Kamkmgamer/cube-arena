// Admin connection to the KRNL OS Supabase project, as the postgres user.
// Reads SUPABASE_DB_PASSWORD (and optionally SUPABASE_DB_CA_CERT_PEM) from the
// env file given in ADMIN_ENV_FILE, written by `vault inject "KRNL OS" FILE`.
// Values are never printed.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

export const PROJECT_REF = 'jrlkifrwgcabqyfnwwvf';
export const POOLER_HOST = 'aws-1-ap-south-1.pooler.supabase.com';

function readEnv(file) {
  // dotenv with quoted values that may span lines (PEM certificates).
  const env = {};
  const re = /^([A-Z_][A-Z0-9_]*)=(?:'([\s\S]*?)'|"([\s\S]*?)"|(.*))$/gm;
  for (const m of readFileSync(file, 'utf8').matchAll(re)) env[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  return env;
}

export function adminSql() {
  const file = process.env.ADMIN_ENV_FILE;
  if (!file) throw new Error('set ADMIN_ENV_FILE to an env file with SUPABASE_DB_PASSWORD');
  const env = readEnv(file);
  if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD missing from ADMIN_ENV_FILE');
  const ca = env.SUPABASE_DB_CA_CERT_PEM;
  return postgres({
    host: POOLER_HOST,
    port: 5432,
    database: 'postgres',
    username: `postgres.${PROJECT_REF}`,
    password: env.SUPABASE_DB_PASSWORD,
    ssl: ca ? { ca, rejectUnauthorized: true } : 'require',
    max: 1,
    onnotice: () => {},
  });
}
