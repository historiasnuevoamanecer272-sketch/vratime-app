import { randomUUID } from 'node:crypto';
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
  // CI may provide values directly instead of a local .env file.
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || localEnv.VITE_SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY || localEnv.SUPABASE_SECRET_KEY;
if (!url || !anonKey || !secretKey) throw new Error('Missing public Supabase values or SUPABASE_SECRET_KEY for the isolated E2E test');

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secretKey, options);
const anonymous = createClient(url, anonKey, options);
const createdUsers = [];
const uploadedPaths = [];

const requireData = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

const signIn = async (email, password) => {
  const client = createClient(url, anonKey, options);
  requireData(await client.auth.signInWithPassword({ email, password }), 'sign in');
  return client;
};

const counts = async () => {
  const result = {};
  for (const table of ['categories', 'listings', 'profiles', 'profile_contacts', 'transactions', 'reviews', 'moderation_actions', 'reports', 'reputation_penalties', 'user_feedback', 'saved_searches', 'search_history', 'listing_favourites', 'listing_matches', 'user_inbox', 'digest_deliveries', 'web_push_subscriptions']) {
    const response = await admin.from(table).select('*', { count: 'exact', head: true });
    if (response.error) throw response.error;
    result[table] = response.count;
  }
  const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authUsers.error) throw authUsers.error;
  result.auth_users = authUsers.data.users.length;
  return result;
};

const cleanup = async () => {
  const ids = createdUsers.map((user) => user.id);
  if (uploadedPaths.length) await admin.storage.from('LISTING-PHOTOS').remove(uploadedPaths);
  if (ids.length) {
    await admin.from('digest_deliveries').delete().in('user_id', ids);
    await admin.from('user_inbox').delete().in('user_id', ids);
    await admin.from('listing_matches').delete().in('user_id', ids);
    await admin.from('listing_favourites').delete().in('user_id', ids);
    await admin.from('search_history').delete().in('user_id', ids);
    await admin.from('saved_searches').delete().in('user_id', ids);
    await admin.from('web_push_subscriptions').delete().in('user_id', ids);
    await admin.from('reputation_penalties').delete().in('user_id', ids);
    await admin.from('reports').delete().in('reporter_id', ids);
    await admin.from('user_feedback').delete().in('user_id', ids);
    await admin.from('moderation_actions').delete().in('moderator_id', ids);
    await admin.from('reviews').delete().in('from_user_id', ids);
    await admin.from('reviews').delete().in('to_user_id', ids);
    await admin.from('transactions').delete().in('giver_id', ids);
    await admin.from('transactions').delete().in('taker_id', ids);
    await admin.from('listings').delete().in('user_id', ids);
    await admin.from('profile_contacts').delete().in('user_id', ids);
    await admin.from('profiles').delete().in('id', ids);
  }
  for (const user of createdUsers) await admin.auth.admin.deleteUser(user.id);
};

const before = await counts();
let passed = false;
try {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const password = `Vra!${randomUUID()}9`;
  const credentials = ['a', 'b', 'c', 'd', 'e'].map((suffix) => ({ email: `vratime-e2e-${stamp}-${suffix}@example.com`, password }));

  for (const credential of credentials) {
    const user = requireData(await admin.auth.admin.createUser({ ...credential, email_confirm: true }), 'create test user').user;
    createdUsers.push(user);
  }

  const [clientA, clientB, clientC, clientD, clientE] = await Promise.all(credentials.map(({ email, password: userPassword }) => signIn(email, userPassword)));
  for (const [index, client] of [clientA, clientB, clientC, clientD, clientE].entries()) {
    requireData(await client.rpc('upsert_my_profile_v2', {
      profile_name: `VratiMe Test ${index + 1}`,
      profile_language: ['ru', 'me', 'en'][index % 3],
      profile_channels: index === 1
        ? [{ messenger_type: 'tg', contact_value: '@vratime_test' }, { messenger_type: 'wa', contact_value: '+38267000001' }]
        : index === 2
          ? [{ messenger_type: 'viber', contact_value: '+38267000002' }, { messenger_type: 'wa', contact_value: '+38267000003' }, { messenger_type: 'tg', contact_value: '+38267000004' }]
          : [{ messenger_type: 'viber', contact_value: `+3826700000${index}` }],
    }), 'create test profile');
  }
  requireData(await admin.from('profiles').update({ app_role: 'admin' }).eq('id', createdUsers[0].id).select('id').single(), 'bootstrap test admin');
  requireData(await clientA.rpc('set_user_role', { target_user_id: createdUsers[2].id, target_role: 'moderator' }), 'assign test moderator');

  const profileCContacts = requireData(await clientC.from('profile_contacts').select('messenger_type, contact_value'), 'read three own contacts');
  if (profileCContacts.length !== 3 || !profileCContacts.some((contact) => contact.messenger_type === 'tg' && contact.contact_value === '+38267000004')) {
    throw new Error('Three independent messenger contacts or Telegram phone were not preserved');
  }

  const categories = requireData(await anonymous.from('categories').select('id, name, category_path, translations').order('id'), 'read categories');
  if (categories.length !== 20 || categories.some((item) => !item.translations?.ru || !item.translations?.me || !item.translations?.en)) {
    throw new Error('Category translation check failed');
  }

  const profileProbe = await anonymous.from('profiles').select('*').limit(1);
  if (!profileProbe.error || ![401, 403].includes(profileProbe.status)) throw new Error('Anonymous profile access was not blocked');

  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfQAAAABJRU5ErkJggg==', 'base64');
  const ownPath = `${createdUsers[0].id}/listings/${randomUUID()}.png`;
  requireData(await clientA.storage.from('LISTING-PHOTOS').upload(ownPath, pixel, { contentType: 'image/png' }), 'owner photo upload');
  uploadedPaths.push(ownPath);
  const foreignPath = `${createdUsers[1].id}/listings/${randomUUID()}.png`;
  const foreignUpload = await clientA.storage.from('LISTING-PHOTOS').upload(foreignPath, pixel, { contentType: 'image/png' });
  if (!foreignUpload.error) {
    uploadedPaths.push(foreignPath);
    throw new Error('Cross-user photo upload was not blocked');
  }

  const category = categories[0];
  const listingPayload = (suffix) => ({
    user_id: createdUsers[0].id,
    type: 'give', status: 'active', category_id: category.id, category: category.name,
    category_path: category.category_path, description: `E2E ${suffix}`, quantity: 2,
    lat: 42.441, lng: 19.263, location_label: 'E2E Podgorica, Montenegro', location_verified_at: new Date().toISOString(), moderation_status: 'pending',
  });

  const invalidAddress = await clientA.from('listings').insert({ ...listingPayload('invalid-address'), location_label: null, location_verified_at: null });
  if (!invalidAddress.error) throw new Error('Listing without a verified address was accepted');

  const raceListing = requireData(await clientA.from('listings').insert(listingPayload('race')).select('id').single(), 'create race listing');
  const hiddenPending = requireData(await anonymous.from('listings').select('id').eq('id', raceListing.id), 'pending visibility probe');
  if (hiddenPending.length) throw new Error('Pending listing was visible anonymously');
  requireData(await clientC.rpc('moderate_listing', { target_listing_id: raceListing.id, decision: 'approved', reason: null }), 'approve race listing');
  const raceTransactionIds = await Promise.all([
    clientB.rpc('book_listing', { target_listing_id: raceListing.id }).then((result) => requireData(result, 'first race request')),
    clientC.rpc('book_listing', { target_listing_id: raceListing.id }).then((result) => requireData(result, 'second race request')),
  ]);
  const requestDeal = requireData(await clientB.rpc('get_my_deals'), 'pending request details').find((deal) => deal.transaction_id === raceTransactionIds[0]);
  const pendingHours = (new Date(requestDeal.expires_at) - new Date(requestDeal.created_at)) / 3600000;
  if (pendingHours < 47.9 || pendingHours > 48.1) throw new Error('Pending request deadline is not 48 hours');
  const accepts = await Promise.allSettled(raceTransactionIds.map((transactionId) => clientA.rpc('accept_deal', { target_transaction_id: transactionId })));
  const accepted = accepts.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.status === 'fulfilled' && !entry.value.error);
  if (accepted.length !== 1) throw new Error(`Acceptance race expected one winner, got ${accepted.length}`);
  const raceTransactionId = raceTransactionIds[accepted[0].index];
  const acceptedDeal = requireData(await clientA.rpc('get_my_deals'), 'accepted deadline details').find((deal) => deal.transaction_id === raceTransactionId);
  const acceptedHours = (new Date(acceptedDeal.expires_at) - new Date(acceptedDeal.accepted_at)) / 3600000;
  if (acceptedHours < 23.9 || acceptedHours > 24.1) throw new Error('Accepted booking deadline is not 24 hours');
  requireData(await clientA.rpc('cancel_booking', { target_transaction_id: raceTransactionId }), 'cancel booking by the other participant');
  const canceledHistory = requireData(await admin.from('transactions').select('canceled_at').eq('id', raceTransactionId).single(), 'read canceled history');
  if (!canceledHistory.canceled_at) throw new Error('Cancellation history was not preserved');
  const restoredListing = requireData(await admin.from('listings').select('status').eq('id', raceListing.id).single(), 'read restored listing');
  if (restoredListing.status !== 'active') throw new Error('Canceled listing was not restored');
  requireData(await clientA.rpc('deactivate_listing', { target_listing_id: raceListing.id }), 'deactivate owner listing');
  const deactivatedListing = requireData(await admin.from('listings').select('status').eq('id', raceListing.id).single(), 'read deactivated listing');
  if (deactivatedListing.status !== 'canceled') throw new Error('Owner listing was not deactivated');

  const dealListing = requireData(await clientA.from('listings').insert({ ...listingPayload('deal'), image_url: admin.storage.from('LISTING-PHOTOS').getPublicUrl(ownPath).data.publicUrl, quantity: 3 }).select('id').single(), 'create deal listing');
  requireData(await clientC.rpc('moderate_listing', { target_listing_id: dealListing.id, decision: 'approved', reason: null }), 'approve deal listing');
  const savedSearchId = requireData(await clientB.rpc('save_search', { search_query: 'стекло', search_filters: { type: 'give' }, wants_daily_digest: true }), 'save private discovery search');
  requireData(await clientB.rpc('record_search_history', { search_query: 'стекло' }), 'record private search history');
  const favourited = requireData(await clientB.rpc('toggle_listing_favourite', { target_listing_id: dealListing.id }), 'favourite listing');
  if (favourited !== true) throw new Error('First favourite toggle did not add the listing');
  const discoveryFeed = requireData(await clientB.rpc('get_my_discovery_feed'), 'read private discovery feed');
  if (!discoveryFeed.saved_searches?.some((search) => search.id === savedSearchId) || !discoveryFeed.favourites?.some((favourite) => favourite.listing_id === dealListing.id)) {
    throw new Error('Discovery feed did not include own saved search and favourite');
  }
  const outsiderFavourites = requireData(await clientD.from('listing_favourites').select('*').eq('user_id', createdUsers[1].id), 'outsider favourite probe');
  if (outsiderFavourites.length) throw new Error('Outsider read another user favourite');
  const outsiderSearches = requireData(await clientD.from('saved_searches').select('*').eq('user_id', createdUsers[1].id), 'outsider saved search probe');
  if (outsiderSearches.length) throw new Error('Outsider read another user saved search');
  const digestDate = new Date().toISOString().slice(0, 10);
  requireData(await admin.from('user_inbox').insert({
    user_id: createdUsers[1].id,
    item_type: 'digest',
    title: 'E2E digest',
    idempotency_key: `e2e-digest-${stamp}`,
  }).select('id').single(), 'create digest inbox item');
  requireData(await admin.from('digest_deliveries').insert({
    user_id: createdUsers[1].id,
    digest_date: digestDate,
    search_count: 1,
  }), 'create daily digest delivery');
  const duplicateDigest = await admin.from('digest_deliveries').insert({
    user_id: createdUsers[1].id,
    digest_date: digestDate,
    search_count: 1,
  });
  if (!duplicateDigest.error) throw new Error('Duplicate daily digest delivery was accepted');
  const transactionId = requireData(await clientB.rpc('book_listing', { target_listing_id: dealListing.id }), 'book deal listing');
  const directStatusUpdate = await clientA.from('listings').update({ status: 'completed' }).eq('id', dealListing.id);
  if (!directStatusUpdate.error) throw new Error('Direct listing status mutation was not blocked');
  const dealsA = requireData(await clientA.rpc('get_my_deals'), 'giver deals');
  const dealsB = requireData(await clientB.rpc('get_my_deals'), 'taker deals');
  if (!dealsA.find((deal) => deal.transaction_id === transactionId)?.contacts?.length || !dealsB.find((deal) => deal.transaction_id === transactionId)?.contacts?.length) {
    throw new Error('Participants did not receive partner contacts');
  }
  const outsiderDeals = requireData(await clientD.rpc('get_my_deals'), 'outsider deals');
  if (outsiderDeals.some((deal) => deal.transaction_id === transactionId)) throw new Error('Outsider received deal data');
  const outsiderContacts = requireData(await clientD.from('profile_contacts').select('*').eq('user_id', createdUsers[0].id), 'outsider contact probe');
  if (outsiderContacts.length) throw new Error('Outsider read another profile contact');
  const outsiderTransactions = requireData(await clientE.from('transactions').select('id').eq('id', transactionId), 'outsider transaction probe');
  if (outsiderTransactions.length) throw new Error('Outsider read another transaction');

  requireData(await clientA.rpc('accept_deal', { target_transaction_id: transactionId }), 'accept deal');
  const firstConfirmation = requireData(await clientA.rpc('confirm_handover', { target_transaction_id: transactionId }), 'giver confirmation');
  if (firstConfirmation.completed) throw new Error('One-sided confirmation completed the deal');
  const completion = requireData(await clientB.rpc('confirm_handover', { target_transaction_id: transactionId }), 'taker confirmation');
  if (!completion.completed || Number(completion.eco_reward) !== 25) throw new Error('Two-sided handover did not complete or reward the taker');
  const repeatedCompletion = requireData(await clientA.rpc('confirm_handover', { target_transaction_id: transactionId }), 'repeat confirmation');
  if (Number(repeatedCompletion.eco_reward) !== 0) throw new Error('Repeated confirmation awarded points twice');
  requireData(await clientA.rpc('submit_review', { target_transaction_id: transactionId, target_rating: 5 }), 'giver review');
  requireData(await clientB.rpc('submit_review', { target_transaction_id: transactionId, target_rating: 4 }), 'taker review');
  const directReview = await clientA.from('reviews').insert({ transaction_id: transactionId, from_user_id: createdUsers[0].id, to_user_id: createdUsers[1].id, rating: 3 });
  if (!directReview.error) throw new Error('Direct review insertion was not blocked');
  const duplicateReview = await clientA.rpc('submit_review', { target_transaction_id: transactionId, target_rating: 5 });
  if (!duplicateReview.error) throw new Error('Duplicate review was not blocked');
  const profileA = requireData(await clientA.from('profiles').select('eco_points, rating').eq('id', createdUsers[0].id).single(), 'read giver profile');
  if (Number(profileA.eco_points) !== 50 || Number(profileA.rating) !== 4) throw new Error('Eco points or rating aggregate is incorrect');

  const reportId = requireData(await clientB.rpc('create_report', { target_kind: 'deal', target_id: transactionId, reason: 'no_show', details: 'E2E completed-deal report' }), 'create post-completion report');
  requireData(await clientA.rpc('resolve_report', { target_report_id: reportId, decision: 'upheld', penalty: 0.5 }), 'resolve report with penalty');
  const penalizedProfile = requireData(await clientA.from('profiles').select('rating_penalty').eq('id', createdUsers[0].id).single(), 'read rating penalty');
  if (Number(penalizedProfile.rating_penalty) !== 0.5) throw new Error('Confirmed report did not apply the selected penalty');

  const feedbackId = requireData(await clientB.rpc('create_feedback', { feedback_type: 'feature', message: 'E2E feedback request', screenshot_url: null }), 'create feedback');
  requireData(await clientC.rpc('set_feedback_status', { target_feedback_id: feedbackId, next_status: 'planned' }), 'advance feedback status');
  const feedbackRow = requireData(await clientB.from('user_feedback').select('status').eq('id', feedbackId).single(), 'read own feedback status');
  if (feedbackRow.status !== 'planned') throw new Error('Feedback status history did not update');

  const takeListing = requireData(await clientE.from('listings').insert({
    ...listingPayload('take'), user_id: createdUsers[4].id, type: 'take', quantity: 1,
  }).select('id').single(), 'create take listing');
  requireData(await clientC.rpc('moderate_listing', { target_listing_id: takeListing.id, decision: 'approved', reason: null }), 'approve take listing');
  const takeTransactionId = requireData(await clientD.rpc('book_listing', { target_listing_id: takeListing.id }), 'book take listing');
  const dealsD = requireData(await clientD.rpc('get_my_deals'), 'giver role for take listing');
  const dealsE = requireData(await clientE.rpc('get_my_deals'), 'taker role for take listing');
  if (dealsD.find((deal) => deal.transaction_id === takeTransactionId)?.role !== 'giver' || dealsE.find((deal) => deal.transaction_id === takeTransactionId)?.role !== 'taker') {
    throw new Error('Take listing roles are incorrect');
  }
  requireData(await clientE.rpc('accept_deal', { target_transaction_id: takeTransactionId }), 'accept take listing');
  requireData(await clientD.rpc('confirm_handover', { target_transaction_id: takeTransactionId }), 'confirm take listing giver');
  const takeCompletion = requireData(await clientE.rpc('confirm_handover', { target_transaction_id: takeTransactionId }), 'confirm take listing taker');
  if (!takeCompletion.completed) throw new Error('Take listing did not complete after both confirmations');

  passed = true;
} finally {
  await cleanup();
}

const after = await counts();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Cleanup count mismatch: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
if (!passed) throw new Error('End-to-end check did not complete');
process.stdout.write(`Live five-user Supabase E2E passed and cleaned up. Counts: ${JSON.stringify(after)}\n`);
