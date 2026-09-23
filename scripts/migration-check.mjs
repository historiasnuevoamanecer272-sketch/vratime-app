import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const dailyDigestPath = path.join(root, 'supabase', 'functions', 'daily-digest', 'index.ts');
const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

if (files.length < 6) throw new Error(`Expected at least 6 migrations, found ${files.length}`);
if (JSON.stringify(files) !== JSON.stringify([...files].sort())) throw new Error('Migrations are not in timestamp order');

const sources = new Map(await Promise.all(files.map(async (file) => [
  file,
  (await fs.readFile(path.join(migrationsDir, file), 'utf8')).replace(/\r\n/g, '\n'),
])));
for (const [file, source] of sources) {
  if (!/^\s*(?:--[^\n]*\n\s*)*begin;/i.test(source) || !/commit;\s*$/i.test(source)) throw new Error(`${file} is not transaction-wrapped`);
}

const combined = [...sources.values()].join('\n');
const requireText = (source, text, label) => {
  if (!source.includes(text)) throw new Error(`Migration security check failed: ${label}`);
};

for (const table of ['categories', 'listings', 'profiles', 'profile_contacts', 'transactions', 'reviews', 'funding_settings', 'support_contributions']) {
  requireText(combined, `alter table public.${table} enable row level security`, `RLS for ${table}`);
}
for (const table of ['saved_searches', 'listing_favourites', 'user_inbox', 'digest_deliveries']) {
  requireText(combined, `alter table public.${table} enable row level security`, `RLS for ${table}`);
}
for (const table of ['search_history', 'listing_matches', 'web_push_subscriptions']) {
  requireText(combined, `alter table public.${table} enable row level security`, `RLS for ${table}`);
}
for (const table of ['collection_points', 'collection_point_materials', 'collection_point_votes', 'collection_point_edits']) {
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
requireText(combined, 'revoke all on public.funding_settings from public, anon, authenticated', 'funding settings protected');
requireText(combined, 'revoke all on public.support_contributions from public, anon, authenticated', 'contributions protected');
requireText(combined, 'grant execute on function public.get_funding_progress() to anon, authenticated', 'public aggregate funding progress RPC');
requireText(combined, 'create unique index if not exists digest_deliveries_one_per_day', 'one digest per person/day');
requireText(combined, 'create policy saved_searches_owner on public.saved_searches', 'saved search owner-only policy');
requireText(combined, 'create policy listing_favourites_owner on public.listing_favourites', 'favourites owner-only policy');
requireText(combined, 'create policy user_inbox_owner_read on public.user_inbox', 'inbox owner-only read policy');
for (const signature of ['save_search(text, jsonb, boolean)', 'toggle_listing_favourite(uuid)', 'record_search_history(text)', 'get_my_discovery_feed()', 'mark_inbox_item_read(uuid)']) {
  requireText(combined, `grant execute on function public.${signature} to authenticated`, `discovery RPC grant for ${signature}`);
}
requireText(combined, "selected_point.created_by = auth.uid() then raise exception 'Point owner cannot vote'", 'collection point self-vote guard');
requireText(combined, "created_at >= now() - interval '180 days'", 'collection point vote expiry');
requireText(combined, 'get_collection_points()', 'public aggregate collection point RPC');
requireText(combined, 'revoke all on public.collection_point_votes from public, anon', 'private collection point vote identities');
for (const signature of ['create_collection_point(text, double precision, double precision, text, text[], text)', 'vote_collection_point(uuid, text)', 'suggest_collection_point_edit(uuid, jsonb, text)', 'get_collection_points()']) {
  requireText(combined, `grant execute on function public.${signature} to authenticated`, `collection point RPC grant for ${signature}`);
}
requireText(combined, 'grant execute on function public.get_collection_points() to anon', 'anonymous aggregate collection point read');
for (const column of ['condition', 'pickup_mode', 'pickup_windows', 'public_lat', 'public_lng', 'public_meeting_label', 'available_quantity', 'reserved_quantity', 'weight_kg']) {
  requireText(combined, `alter table public.listings add column if not exists ${column}`, `listing privacy metadata column ${column}`);
}
requireText(combined, 'create or replace function public.get_public_map_listings()', 'public map listings RPC');
requireText(combined, 'create or replace function public.get_transaction_pickup_details(target_transaction_id uuid)', 'participant pickup details RPC');
requireText(combined, 'create or replace function public.set_listing_public_coordinates()', 'server-computed public coordinates');
requireText(combined, "create policy listings_authenticated_read on public.listings for select to authenticated\n  using (user_id = auth.uid() or public.is_staff())", 'direct listing select limited to owner or staff');
requireText(combined, 'grant execute on function public.get_public_map_listings() to anon, authenticated', 'public map listing RPC grant');
requireText(combined, 'grant execute on function public.get_transaction_pickup_details(uuid) to authenticated', 'pickup details RPC grant');

const dailyDigest = await fs.readFile(dailyDigestPath, 'utf8');
requireText(dailyDigest, "Deno.env.get('DAILY_DIGEST_SECRET')", 'daily digest scheduler secret');
requireText(dailyDigest, "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')", 'daily digest server-only service role');
requireText(dailyDigest, 'user_inbox?on_conflict=user_id,idempotency_key', 'digest inbox idempotency');
requireText(dailyDigest, 'digest_deliveries?on_conflict=user_id,digest_date', 'daily delivery idempotency');
requireText(dailyDigest, 'web_push_subscriptions?select=id,endpoint,p256dh,auth,enabled', 'digest opt-in push subscription read');
requireText(dailyDigest, 'enabled=eq.true', 'digest push only enabled subscriptions');

const multiContacts = sources.get('20260820233000_multi_messenger_contacts.sql') || '';
requireText(multiContacts, 'primary key (user_id, messenger_type)', 'one protected contact per messenger');
requireText(multiContacts, "channel.messenger_type not in ('viber', 'wa', 'tg')", 'messenger allowlist');

const participantCancel = sources.get('20260821000000_allow_both_participants_to_cancel.sql') || '';
requireText(participantCancel, 'auth.uid() not in (selected_transaction.giver_id, selected_transaction.taker_id)', 'participant-only cancellation');
requireText(participantCancel, "update public.listings set status = 'active'", 'listing restored after cancellation');

const telegramPhone = sources.get('20260821001000_allow_telegram_phone_contacts.sql') || '';
requireText(telegramPhone, "!~ '^\\+[1-9][0-9]{6,14}$'", 'Telegram international phone validation');
requireText(telegramPhone, 'grant execute on function public.upsert_my_profile_v2(text, text, jsonb) to authenticated', 'profile RPC grant');

const telegramDeepLink = sources.get('20260919000000_fix_telegram_phone_deep_link.sql') || '';
requireText(telegramDeepLink, "'tg://resolve?phone='", 'Telegram phone deep link');
requireText(telegramDeepLink, 'revoke all on function public.get_my_deals() from public, anon', 'protected refreshed deal RPC');

const immediateContacts = sources.get('20260921010000_immediate_contacts_and_24h_reservations.sql') || '';
requireText(immediateContacts, "expires_at = now() + interval '24 hours'", '24-hour accepted reservation');
requireText(immediateContacts, 'l.type::text', 'listing enum cast in deal RPC');
requireText(immediateContacts, 'where contact.user_id = partner.id\n      and t.canceled_at is null', 'contacts visible immediately to request participants');
requireText(immediateContacts, 'revoke execute on function public.get_my_deals() from public, anon', 'immediate contacts RPC remains private');

const rpcHardening = sources.get('20260821002000_restrict_rpc_execution.sql') || '';
for (const signature of ['book_listing(uuid)', 'cancel_booking(uuid)', 'complete_deal(uuid)', 'get_my_deals()']) {
  requireText(rpcHardening, `revoke execute on function public.${signature} from public, anon`, `anonymous RPC revoke for ${signature}`);
}

process.stdout.write(`Migration topology/security check passed across ${files.length} ordered migrations.\n`);
