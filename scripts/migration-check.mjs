import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

if (files.length < 6) throw new Error(`Expected at least 6 migrations, found ${files.length}`);
if (JSON.stringify(files) !== JSON.stringify([...files].sort())) throw new Error('Migrations are not in timestamp order');

const sources = new Map(await Promise.all(files.map(async (file) => [file, await fs.readFile(path.join(migrationsDir, file), 'utf8')])));
for (const [file, source] of sources) {
  if (!/^\s*(?:--[^\n]*\n\s*)*begin;/i.test(source) || !/commit;\s*$/i.test(source)) throw new Error(`${file} is not transaction-wrapped`);
}

const combined = [...sources.values()].join('\n');
const requireText = (source, text, label) => {
  if (!source.includes(text)) throw new Error(`Migration security check failed: ${label}`);
};

for (const table of ['categories', 'listings', 'profiles', 'profile_contacts', 'transactions', 'reviews']) {
  requireText(combined, `alter table public.${table} enable row level security`, `RLS for ${table}`);
}
requireText(combined, 'revoke all on public.profiles from anon', 'anonymous profile access revoked');
requireText(combined, 'revoke all on public.profile_contacts from anon', 'anonymous contact access revoked');
requireText(combined, 'with check (user_id = auth.uid() and status = \'active\')', 'listing ownership check');
requireText(combined, "(storage.foldername(name))[1] = auth.uid()::text", 'owner-only photo folder');
requireText(combined, 'create unique index if not exists transactions_one_open_per_listing', 'one active booking constraint');
requireText(combined, 'create unique index if not exists reviews_one_per_participant', 'one review per participant');
requireText(combined, 'revoke update on public.listings from anon, authenticated', 'server-only listing status changes');
requireText(combined, 'revoke insert on public.reviews from anon, authenticated', 'server-only reviews');

const multiContacts = sources.get('20260820233000_multi_messenger_contacts.sql') || '';
requireText(multiContacts, 'primary key (user_id, messenger_type)', 'one protected contact per messenger');
requireText(multiContacts, "channel.messenger_type not in ('viber', 'wa', 'tg')", 'messenger allowlist');

const participantCancel = sources.get('20260821000000_allow_both_participants_to_cancel.sql') || '';
requireText(participantCancel, 'auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id)', 'participant-only cancellation');
requireText(participantCancel, "update public.listings set status = 'active'", 'listing restored after cancellation');

const telegramPhone = sources.get('20260821001000_allow_telegram_phone_contacts.sql') || '';
requireText(telegramPhone, "!~ '^\\+[1-9][0-9]{6,14}$'", 'Telegram international phone validation');
requireText(telegramPhone, 'grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated', 'profile RPC grant');

const rpcHardening = sources.get('20260821002000_restrict_rpc_execution.sql') || '';
for (const signature of ['book_listing(uuid)', 'cancel_booking(uuid)', 'complete_deal(uuid)', 'get_my_deals()']) {
  requireText(rpcHardening, `revoke execute on function public.${signature} from public, anon`, `anonymous RPC revoke for ${signature}`);
}

process.stdout.write(`Migration topology/security check passed across ${files.length} ordered migrations.\n`);
