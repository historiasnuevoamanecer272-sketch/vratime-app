import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { supportedLanguages } from '../src/i18n/languages.js';

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
if (categories.data.some((item) => supportedLanguages.some((language) => !item.translations?.[language]))) throw new Error('A category is missing a supported language translation');

const listings = await anonymous.from('listings').select('id, status, category_path, quantity, lat, lng').eq('status', 'active');
if (listings.error) throw new Error(`Active listings are not publicly readable: ${listings.error.message}`);
if (listings.data.some((item) => item.status !== 'active')) throw new Error('Anonymous listing response contains a non-active listing');
if (listings.data.length) throw new Error('Direct anonymous listing access bypassed the public map privacy RPC');

const publicMap = await anonymous.rpc('get_public_map_listings');
if (publicMap.error || !Array.isArray(publicMap.data)) throw new Error(`Public map is unavailable: ${publicMap.error?.message || 'invalid response'}`);
for (const listing of publicMap.data) {
  if (listing.status !== 'active') throw new Error('Public map contains an inactive listing');
  if (listing.lat !== listing.public_lat || listing.lng !== listing.public_lng) throw new Error('Public map coordinates do not match the public location');
  if (['location_label', 'location_verified_at', 'pickup_windows'].some((key) => key in listing)) throw new Error('Public map exposes private pickup fields');
}

for (const table of ['profiles', 'profile_contacts', 'transactions', 'reviews', 'funding_settings', 'support_contributions']) {
  const probe = await anonymous.from(table).select('*').limit(1);
  if (!probe.error || ![401, 403].includes(probe.status)) throw new Error(`Anonymous access to ${table} was not blocked`);
  if (Array.isArray(probe.data) && probe.data.length) throw new Error(`Anonymous access leaked rows from ${table}`);
}

const funding = await anonymous.rpc('get_funding_progress');
if (funding.error) throw new Error(`Public funding progress is unavailable: ${funding.error.message}`);
if (!Array.isArray(funding.data) || funding.data.length !== 1) throw new Error('Funding progress must return one aggregate row');
const fundingRow = funding.data[0];
for (const key of ['monthly_target_eur_cents', 'annual_target_eur_cents', 'month_covered_eur_cents', 'year_collected_eur_cents', 'reserve_eur_cents', 'supporters_count']) {
  if (!(key in fundingRow)) throw new Error(`Funding progress is missing ${key}`);
}
if ('supporter_hash' in fundingRow || 'external_event_id' in fundingRow) throw new Error('Funding progress leaked private contribution identifiers');

const privateRpc = await anonymous.rpc('get_my_deals');
const privateRpcBlockedByDatabase = privateRpc.error?.code === 'P0001' && privateRpc.error?.message === 'Authentication required';
if (!privateRpc.error || (!privateRpcBlockedByDatabase && ![401, 403].includes(privateRpc.status))) {
  const rowCount = Array.isArray(privateRpc.data) ? privateRpc.data.length : 0;
  throw new Error(`Anonymous execution of get_my_deals was not blocked (status ${privateRpc.status}, rows ${rowCount}, active listings ${listings.data.length})`);
}

process.stdout.write(`Live public/privacy check passed: 20 translated categories, ${publicMap.data.length} public map listings, direct anonymous listing access blocked, protected profile/contact/deal/funding tables.\n`);
