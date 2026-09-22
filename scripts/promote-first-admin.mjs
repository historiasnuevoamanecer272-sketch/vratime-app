import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const userId = process.env.SUPABASE_ADMIN_USER_ID;

if (!url || !secret || !userId) {
  throw new Error('Set VITE_SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_ADMIN_USER_ID.');
}
if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(userId)) throw new Error('SUPABASE_ADMIN_USER_ID must be a UUID.');

const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: existing, error: readError } = await client.from('profiles').select('id, app_role').eq('id', userId).single();
if (readError) throw readError;
const { count, error: countError } = await client.from('profiles').select('id', { count: 'exact', head: true }).eq('app_role', 'admin');
if (countError) throw countError;
if (count > 0 && existing.app_role !== 'admin') throw new Error('An administrator already exists. Use the in-app role manager.');

const { error } = await client.from('profiles').update({ app_role: 'admin' }).eq('id', userId);
if (error) throw error;
process.stdout.write(`Administrator assigned to ${userId}.\n`);
