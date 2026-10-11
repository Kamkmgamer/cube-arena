// Give cube_app a fresh random password and write the app's connection
// settings to an env file (default .env.local). Prints key names only.
//   ADMIN_ENV_FILE=/path/to/admin.env node scripts/set-app-password.mjs [.env.local]
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { POOLER_HOST, PROJECT_REF, adminSql } from './admin-db.mjs';

const out = process.argv[2] || '.env.local';
const alnum = (bytes) => randomBytes(bytes).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
const password = alnum(48);
if (password.length < 32) throw new Error('password generation failed');

const sql = adminSql();
try {
  // Alphanumeric only, so embedding it is safe; ALTER ROLE takes no parameters.
  await sql.unsafe(`alter role cube_app with login password '${password}'`);
} finally {
  await sql.end();
}

const values = {
  CUBE_DATABASE_URL: `postgres://cube_app.${PROJECT_REF}:${password}@${POOLER_HOST}:6543/postgres`,
};
const keep = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter((l) => l && !Object.keys(values).some((k) => l.startsWith(`${k}=`))) : [];
writeFileSync(out, [...keep, ...Object.entries(values).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n', { mode: 0o600 });
console.log(`wrote ${Object.keys(values).join(', ')} to ${out}`);
