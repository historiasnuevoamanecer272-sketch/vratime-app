import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(import.meta.dirname, '..');
const envPath = path.join(root, '.env');
const localEnv = {};
const source = await fs.readFile(envPath, 'utf8');
for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) localEnv[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
}

const url = process.env.SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || localEnv.SUPABASE_SECRET_KEY;
if (!url || !secretKey) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY');

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const fetchAllRows = async (schema, table) => {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const result = await admin.schema(schema).from(table).select('*').range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(`${schema}.${table}: ${result.error.message}`);
    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
  }
};

const fetchUsers = async () => {
  const users = [];
  for (let page = 1; ; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error(`auth.users: ${result.error.message}`);
    users.push(...result.data.users);
    if (result.data.users.length < 1000) return users;
  }
};

const fetchStorageManifest = async (prefix = '') => {
  const result = await admin.storage.from('LISTING-PHOTOS').list(prefix, { limit: 1000, offset: 0 });
  if (result.error) throw new Error(`storage LISTING-PHOTOS/${prefix}: ${result.error.message}`);
  const files = [];
  for (const entry of result.data) {
    const entryPath = `${prefix}${entry.name}`;
    if (entry.id) files.push({ path: entryPath, metadata: entry.metadata ?? null, created_at: entry.created_at ?? null, updated_at: entry.updated_at ?? null });
    else files.push(...await fetchStorageManifest(`${entryPath}/`));
  }
  return files;
};

const snapshot = {
  format: 'vratime-supabase-data-snapshot-v1',
  created_at: new Date().toISOString(),
  source_project: new URL(url).host,
  tables: {},
  auth_users: await fetchUsers(),
};

for (const table of ['categories', 'listings', 'profiles', 'profile_contacts', 'transactions', 'reviews']) {
  snapshot.tables[table] = await fetchAllRows('public', table);
}
snapshot.storage_objects = await fetchStorageManifest();

const destination = path.join(root, '.private-backups');
await fs.mkdir(destination, { recursive: true });
const filename = `supabase-data-${snapshot.created_at.replace(/[:.]/g, '-')}.json`;
const target = path.join(destination, filename);
await fs.writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

const counts = Object.fromEntries(Object.entries(snapshot.tables).map(([table, rows]) => [table, rows.length]));
process.stdout.write(`${JSON.stringify({ backup: path.relative(root, target), counts, auth_users: snapshot.auth_users.length, storage_objects: snapshot.storage_objects.length })}\n`);
