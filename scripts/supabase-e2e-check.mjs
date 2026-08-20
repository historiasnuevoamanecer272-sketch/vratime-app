import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !anonKey || !secretKey) throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SECRET_KEY');

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
  for (const table of ['categories', 'listings', 'profiles', 'transactions', 'reviews']) {
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
  const credentials = ['a', 'b', 'c'].map((suffix) => ({ email: `vratime-e2e-${stamp}-${suffix}@example.com`, password }));

  for (const credential of credentials) {
    const user = requireData(await admin.auth.admin.createUser({ ...credential, email_confirm: true }), 'create test user').user;
    createdUsers.push(user);
  }

  const [clientA, clientB, clientC] = await Promise.all(credentials.map(({ email, password: userPassword }) => signIn(email, userPassword)));
  for (const [index, client] of [clientA, clientB, clientC].entries()) {
    requireData(await client.rpc('upsert_my_profile_v2', {
      profile_name: `VratiMe Test ${index + 1}`,
      profile_language: ['ru', 'me', 'en'][index],
      profile_channels: index === 1
        ? [{ messenger_type: 'tg', contact_value: '@vratime_test' }, { messenger_type: 'wa', contact_value: '+38267000001' }]
        : [{ messenger_type: 'viber', contact_value: '+38267000000' }],
    }), 'create test profile');
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
    lat: 42.441, lng: 19.263,
  });

  const raceListing = requireData(await clientA.from('listings').insert(listingPayload('race')).select('id').single(), 'create race listing');
  const race = await Promise.allSettled([
    clientB.rpc('book_listing', { target_listing_id: raceListing.id }),
    clientC.rpc('book_listing', { target_listing_id: raceListing.id }),
  ]);
  const successfulBookings = race.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.status === 'fulfilled' && !entry.value.error);
  if (successfulBookings.length !== 1) throw new Error(`Race protection expected one winner, got ${successfulBookings.length}`);
  const winner = successfulBookings[0];
  const winningClient = winner.index === 0 ? clientB : clientC;
  const raceTransactionId = winner.entry.value.data;
  requireData(await winningClient.rpc('cancel_booking', { target_transaction_id: raceTransactionId }), 'cancel race booking');
  const canceledHistory = requireData(await admin.from('transactions').select('canceled_at').eq('id', raceTransactionId).single(), 'read canceled history');
  if (!canceledHistory.canceled_at) throw new Error('Cancellation history was not preserved');
  const restoredListing = requireData(await admin.from('listings').select('status').eq('id', raceListing.id).single(), 'read restored listing');
  if (restoredListing.status !== 'active') throw new Error('Canceled listing was not restored');
  requireData(await clientA.rpc('deactivate_listing', { target_listing_id: raceListing.id }), 'deactivate owner listing');
  const deactivatedListing = requireData(await admin.from('listings').select('status').eq('id', raceListing.id).single(), 'read deactivated listing');
  if (deactivatedListing.status !== 'canceled') throw new Error('Owner listing was not deactivated');

  const dealListing = requireData(await clientA.from('listings').insert({ ...listingPayload('deal'), image_url: admin.storage.from('LISTING-PHOTOS').getPublicUrl(ownPath).data.publicUrl, quantity: 3 }).select('id').single(), 'create deal listing');
  const transactionId = requireData(await clientB.rpc('book_listing', { target_listing_id: dealListing.id }), 'book deal listing');
  const directStatusUpdate = await clientA.from('listings').update({ status: 'completed' }).eq('id', dealListing.id);
  if (!directStatusUpdate.error) throw new Error('Direct listing status mutation was not blocked');
  const dealsA = requireData(await clientA.rpc('get_my_deals'), 'giver deals');
  const dealsB = requireData(await clientB.rpc('get_my_deals'), 'taker deals');
  if (!dealsA.find((deal) => deal.transaction_id === transactionId)?.contacts?.length || !dealsB.find((deal) => deal.transaction_id === transactionId)?.contacts?.length) {
    throw new Error('Participants did not receive partner contacts');
  }
  const outsiderDeals = requireData(await clientC.rpc('get_my_deals'), 'outsider deals');
  if (outsiderDeals.some((deal) => deal.transaction_id === transactionId)) throw new Error('Outsider received deal data');
  const outsiderContacts = requireData(await clientC.from('profile_contacts').select('*').eq('user_id', createdUsers[0].id), 'outsider contact probe');
  if (outsiderContacts.length) throw new Error('Outsider read another profile contact');
  const outsiderTransactions = requireData(await clientC.from('transactions').select('id').eq('id', transactionId), 'outsider transaction probe');
  if (outsiderTransactions.length) throw new Error('Outsider read another transaction');

  const completion = requireData(await clientA.rpc('complete_deal', { target_transaction_id: transactionId }), 'complete deal');
  if (Number(completion.eco_reward) !== 50) throw new Error('First completion did not award 50 points');
  const repeatedCompletion = requireData(await clientA.rpc('complete_deal', { target_transaction_id: transactionId }), 'repeat completion');
  if (Number(repeatedCompletion.eco_reward) !== 0) throw new Error('Repeated completion awarded points twice');
  requireData(await clientA.rpc('submit_review', { target_transaction_id: transactionId, target_rating: 5 }), 'giver review');
  requireData(await clientB.rpc('submit_review', { target_transaction_id: transactionId, target_rating: 4 }), 'taker review');
  const directReview = await clientA.from('reviews').insert({ transaction_id: transactionId, from_user_id: createdUsers[0].id, to_user_id: createdUsers[1].id, rating: 3 });
  if (!directReview.error) throw new Error('Direct review insertion was not blocked');
  const duplicateReview = await clientA.rpc('submit_review', { target_transaction_id: transactionId, target_rating: 5 });
  if (!duplicateReview.error) throw new Error('Duplicate review was not blocked');
  const profileA = requireData(await clientA.from('profiles').select('eco_points, rating').eq('id', createdUsers[0].id).single(), 'read giver profile');
  if (Number(profileA.eco_points) !== 50 || Number(profileA.rating) !== 4) throw new Error('Eco points or rating aggregate is incorrect');

  passed = true;
} finally {
  await cleanup();
}

const after = await counts();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Cleanup count mismatch: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
if (!passed) throw new Error('End-to-end check did not complete');
process.stdout.write(`Live Supabase E2E passed and cleaned up. Counts: ${JSON.stringify(after)}\n`);
