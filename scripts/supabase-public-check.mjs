import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(import.meta.dirname, '..');
const localEnv = {};
try {
  const source = await fs.readFile(path.join(root, '.env'), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) localEnv[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {
  // CI may provide the public values directly instead of a local .env file.
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error('Missing public Supabase URL or anon key');

const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const categories = await anonymous.from('categories').select('id, translations').order('id');
if (categories.error) throw new Error(`Categories are not publicly readable: ${categories.error.message}`);
if (categories.data.length !== 20) throw new Error(`Expected 20 categories, got ${categories.data.length}`);
if (categories.data.some((item) => !item.translations?.ru || !item.translations?.me || !item.translations?.en)) throw new Error('A category is missing ru/me/en translations');

const listings = await anonymous.from('listings').select('id, status, category_path, quantity, lat, lng').eq('status', 'active');
if (listings.error) throw new Error(`Active listings are not publicly readable: ${listings.error.message}`);
if (listings.data.some((item) => item.status !== 'active')) throw new Error('Anonymous listing response contains a non-active listing');

for (const table of ['profiles', 'profile_contacts', 'transactions', 'reviews']) {
  const probe = await anonymous.from(table).select('*').limit(1);
  if (!probe.error || ![401, 403].includes(probe.status)) throw new Error(`Anonymous access to ${table} was not blocked`);
  if (Array.isArray(probe.data) && probe.data.length) throw new Error(`Anonymous access leaked rows from ${table}`);
}

const privateRpc = await anonymous.rpc('get_my_deals');
if (!privateRpc.error || ![401, 403].includes(privateRpc.status)) {
  const rowCount = Array.isArray(privateRpc.data) ? privateRpc.data.length : 0;
  throw new Error(`Anonymous execution of get_my_deals was not blocked (status ${privateRpc.status}, rows ${rowCount}, active listings ${listings.data.length})`);
}

process.stdout.write(`Live public/privacy check passed: 20 translated categories, ${listings.data.length} active listings, protected profile/contact/deal tables.\n`);
