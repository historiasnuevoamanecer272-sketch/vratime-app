import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createECDH, randomBytes } from 'node:crypto';
import path from 'node:path';
import { notificationPayload } from '../supabase/functions/notifications-dispatch/logic.mjs';
const toolPath = process.argv.find((arg) => arg.startsWith('--pg-tools='))?.slice('--pg-tools='.length);
if (!toolPath) throw new Error('Pass --pg-tools=/absolute/path/to/@electric-sql/pglite for offline notification database checks.');
const { PGlite } = createRequire(import.meta.url)(path.resolve(toolPath));
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const listing = '33333333-3333-4333-8333-333333333333', transaction = '44444444-4444-4444-8444-444444444444';
const key = createECDH('prime256v1'); key.generateKeys();
const p256dh = key.getPublicKey().toString('base64url'), auth = randomBytes(16).toString('base64url');
const endpoint = 'https://fcm.googleapis.com/fcm/send/test-notification-owner', foreignEndpoint = 'https://web.push.apple.com/test-notification-other';
let passed = 0, failed = 0;
const check = async (name, run) => { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } };
const actor = (role, userId, run) => db.transaction(async (tx) => {
  assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
  await tx.exec(`set local role ${role}`); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [userId || '']); return run(tx);
});
const service = (name, params = []) => actor('service_role', null, async (tx) => (await tx.query(`select public.${name}(${params.map((_, index) => `$${index + 1}`).join(',')}) as result`, params)).rows[0].result);
const subscribe = (userId, url = endpoint) => actor('authenticated', userId, async (tx) => (await tx.query('select public.register_push_subscription($1,$2,$3) as id', [url, p256dh, auth])).rows[0].id);
let subscriptionId;
try {
  await db.exec(`create role authenticated; create role anon; create role service_role bypassrls; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table public.profiles(id uuid primary key,language text,preferred_language text);
    create table public.categories(id bigint primary key,parent_id bigint,name text,translations jsonb not null default '{}',category_path text);
    create type public.listing_type as enum('give','take','lend'); create type public.listing_status as enum('active','reserved','completed','canceled');
    create table public.listings(id uuid primary key,user_id uuid,type public.listing_type,status public.listing_status default 'active',moderation_status text default 'approved',category_id bigint,category text,category_path text,description text,quantity integer default 1,available_quantity integer default 1,lat double precision,lng double precision,created_at timestamptz default now());
    create table public.transactions(id uuid primary key,listing_id uuid,giver_id uuid,taker_id uuid,booked_by uuid,accepted_at timestamptz,giver_confirmed_at timestamptz,taker_confirmed_at timestamptz,completed_at timestamptz,canceled_at timestamptz,handed_over_at timestamptz,returned_at timestamptz,created_at timestamptz default now());`);
  await db.query("insert into public.profiles values($1,'fr','fr'),($2,'de','de')", [owner, other]);
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  await db.exec(readFileSync(new URL('20260923010000_discovery_and_digest.sql', migrations), 'utf8'));
  const file = readdirSync(migrations).find((name) => name.endsWith('_reliable_notifications_and_digest.sql'));
  assert.ok(file); await db.exec(readFileSync(new URL(file, migrations), 'utf8'));

  await check('subscription registration derives owner from auth and rejects SSRF, invalid keys and anonymous access', async () => {
    subscriptionId = await subscribe(owner); assert.match(subscriptionId, /^[0-9a-f-]{36}$/);
    assert.equal(await subscribe(owner), subscriptionId);
    await subscribe(other, foreignEndpoint);
    for (const url of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/private', 'https://fcm.googleapis.com.evil.example/a', 'https://fcm.googleapis.com@127.0.0.1/a', 'https://web.push.apple.com:444/a']) await assert.rejects(subscribe(owner, url), /push_invalid_subscription/);
    await assert.rejects(actor('authenticated', owner, (tx) => tx.query('select public.register_push_subscription($1,$2,$3)', [endpoint, 'invalid', 'invalid'])), /push_invalid_subscription/);
    await assert.rejects(actor('anon', null, (tx) => tx.query('select public.register_push_subscription($1,$2,$3)', [endpoint, p256dh, auth])), (error) => error.code === '42501');
  });
  await check('subscription RLS hides foreign recipients and direct mutations cannot bypass validated RPCs', async () => {
    const rows = await actor('authenticated', other, async (tx) => (await tx.query('select user_id,endpoint from public.web_push_subscriptions')).rows);
    assert.deepEqual(rows, [{ user_id: other, endpoint: foreignEndpoint }]);
    await assert.rejects(actor('authenticated', owner, (tx) => tx.query("update public.web_push_subscriptions set endpoint='https://127.0.0.1/test' where id=$1", [subscriptionId])), (error) => error.code === '42501');
    assert.equal(await actor('authenticated', other, async (tx) => (await tx.query('select public.disable_push_subscription($1) as result', [endpoint])).rows[0].result), false);
  });
  await check('real transaction changes create localized requested, accepted and handover inbox events once', async () => {
    await db.query("insert into public.listings(id,user_id,type,category_id,category,category_path,description,lat,lng) values($1,$2,'give',1,'Jars','glass/jars','Useful jars',42.4,19.2)", [listing, owner]);
    await db.query('insert into public.transactions(id,listing_id,giver_id,taker_id,booked_by) values($1,$2,$3,$4,$4)', [transaction, listing, owner, other]);
    await db.query('update public.transactions set accepted_at=now() where id=$1', [transaction]);
    await db.query('update public.transactions set giver_confirmed_at=now() where id=$1', [transaction]);
    await db.query('update public.transactions set giver_confirmed_at=giver_confirmed_at where id=$1', [transaction]);
    const rows = (await db.query("select user_id,title,payload->>'notification_event' as event from public.user_inbox order by created_at,id")).rows;
    assert.equal(rows.filter((row) => row.event === 'requested' && row.user_id === owner).length, 1);
    assert.equal(rows.find((row) => row.event === 'requested').title, 'Nouvelle demande');
    assert.equal(rows.find((row) => row.event === 'accepted').user_id, other);
    assert.equal(rows.find((row) => row.event === 'accepted').title, 'Anfrage angenommen');
    assert.equal(rows.filter((row) => row.event === 'handover').length, 1);
  });
  await check('SQL and encrypted-push copy agree in all five supported languages without private details', async () => {
    for (const language of ['ru', 'me', 'en', 'fr', 'de']) {
      for (const event of ['requested', 'accepted', 'handover', 'digest', 'reminder', 'activity']) {
        const copy = (await db.query('select notifications_private.notification_copy($1,$2) as result', [event, language])).rows[0].result;
        const payload = notificationPayload({ id: 'copy-test', language, event_type: event });
        assert.equal(copy.title, payload.title); assert.equal(copy.body, payload.body);
      }
    }
  });
  await check('queue claims are service-only leases and stale acknowledgments cannot mark work sent', async () => {
    await assert.rejects(actor('authenticated', owner, (tx) => tx.query('select public.claim_notification_deliveries(10)')), (error) => error.code === '42501');
    const jobs = await service('claim_notification_deliveries', [10]); assert.ok(jobs.length >= 3);
    assert.equal((await service('claim_notification_deliveries', [10])).length, 0);
    assert.equal(await service('finish_notification_delivery', [jobs[0].id, '00000000-0000-4000-8000-000000000000', 201]), false);
    await db.query("update notifications_private.deliveries set leased_until=now()-interval '1 second' where id=$1", [jobs[0].id]);
    const retry = (await service('claim_notification_deliveries', [10])).find((row) => row.id === jobs[0].id);
    assert.notEqual(retry.lease_token, jobs[0].lease_token);
    assert.equal(await service('finish_notification_delivery', [jobs[0].id, jobs[0].lease_token, 201]), false);
    assert.equal(await service('finish_notification_delivery', [retry.id, retry.lease_token, 201]), true);
    assert.equal((await db.query('select status from notifications_private.deliveries where id=$1', [retry.id])).rows[0].status, 'sent');
    for (const job of jobs.slice(1)) await service('finish_notification_delivery', [job.id, job.lease_token, 201]);
  });
  await check('failed delivery retries with backoff and HTTP410 disables only the expired subscription', async () => {
    await db.query("insert into public.user_inbox(user_id,item_type,title,payload,idempotency_key) values($1,'system','Retry', '{\"notification_event\":\"activity\"}', 'retry-check')", [owner]);
    const [job] = await service('claim_notification_deliveries', [10]);
    await service('finish_notification_delivery', [job.id, job.lease_token, 503]);
    assert.equal((await db.query('select status from notifications_private.deliveries where id=$1', [job.id])).rows[0].status, 'pending');
    assert.equal((await service('claim_notification_deliveries', [10])).length, 0);
    await db.query("update notifications_private.deliveries set next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
    const [retry] = await service('claim_notification_deliveries', [10]);
    await service('finish_notification_delivery', [retry.id, retry.lease_token, 410]);
    assert.equal((await db.query('select enabled from public.web_push_subscriptions where id=$1', [subscriptionId])).rows[0].enabled, false);
    assert.equal((await db.query('select enabled from public.web_push_subscriptions where endpoint=$1', [foreignEndpoint])).rows[0].enabled, true);
    await subscribe(owner);
  });
  await check('delivery attempts stop at the bound, including a worker crash on its last lease', async () => {
    for (const failure of ['acknowledged-error', 'expired-lease']) {
      await db.query("insert into public.user_inbox(user_id,item_type,title,payload,idempotency_key) values($1,'system','Retry limit','{}',$2)", [owner, `retry-limit-${failure}`]);
      await db.query("update notifications_private.deliveries set attempts=7 where status='pending'");
      const [job] = await service('claim_notification_deliveries', [10]); assert.equal(job.attempts, 8);
      if (failure === 'acknowledged-error') await service('finish_notification_delivery', [job.id, job.lease_token, 503]);
      else await db.query("update notifications_private.deliveries set leased_until=now()-interval '1 second' where id=$1", [job.id]);
      assert.equal((await service('claim_notification_deliveries', [10])).length, 0);
      assert.equal((await db.query('select status from notifications_private.deliveries where id=$1', [job.id])).rows[0].status, 'failed');
    }
    const status = await actor('authenticated', owner, async (tx) => (await tx.query('select public.get_my_push_status($1) as result', [endpoint])).rows[0].result);
    assert.equal(Number(status.failed_count), 2);
  });
  await check('digest candidates preserve type, category, owner, time and distance filters with all language names', async () => {
    await db.query('insert into public.categories values(1,null,$1,$2::jsonb,$3)', ['Glass', JSON.stringify({ ru: 'Стекло', me: 'Staklo', en: 'Glass', fr: 'Bouteilles', de: 'Gläser' }), 'glass']);
    await db.query("insert into public.saved_searches(user_id,query,filters) values($1,'bouteilles',$2::jsonb)", [other, JSON.stringify({ type: 'give', category: 'glass', distance: '5', origin: [42.4, 19.2] })]);
    await db.query("insert into public.listings(id,user_id,type,category_id,category,category_path,description,lat,lng) values(gen_random_uuid(),$1,'take',1,'Glass','glass/jars','bouteilles',42.4,19.2),(gen_random_uuid(),$1,'give',1,'Glass','glass/jars','bouteilles',44,21)", [owner]);
    const [job] = await service('claim_daily_digest_jobs', [10]); assert.ok(job); assert.equal(job.language, 'de');
    assert.equal(job.searches.length, 1);
    assert.deepEqual(job.candidates.map((candidate) => candidate.id), [listing]);
    assert.match(job.candidates[0].category_text, /Bouteilles/);
    const before = (await db.query('select last_digest_at from public.saved_searches where user_id=$1', [other])).rows[0].last_digest_at;
    assert.equal(before, null);
    await assert.rejects(service('finish_daily_digest_job', [job.id, job.lease_token, JSON.stringify([{ search_id: job.searches[0].id, listing_id: '99999999-9999-4999-8999-999999999999' }]), null]), /notification_invalid_matches/);
    await service('finish_daily_digest_job', [job.id, job.lease_token, JSON.stringify([{ search_id: job.searches[0].id, listing_id: listing }]), null]);
    const delivery = (await db.query('select * from public.digest_deliveries where user_id=$1', [other])).rows[0];
    assert.equal(delivery.delivered_at, null, 'inbox insertion must not claim a provider delivery');
    assert.ok((await db.query('select last_digest_at from public.saved_searches where user_id=$1', [other])).rows[0].last_digest_at);
    assert.equal((await service('claim_daily_digest_jobs', [10])).length, 0);
    const [push] = await service('claim_notification_deliveries', [10]);
    await service('finish_notification_delivery', [push.id, push.lease_token, 201]);
    assert.ok((await db.query('select delivered_at from public.digest_deliveries where user_id=$1', [other])).rows[0].delivered_at);
  });
  await check('distance eligibility requires a valid saved origin for a bounded search, with array and object compatibility', async () => {
    const accepts = async (filters, lat = 42.4, lng = 19.2) => (await db.query('select notifications_private.distance_matches($1::jsonb,$2,$3) as result', [JSON.stringify(filters), lat, lng])).rows[0].result;
    assert.equal(await accepts({ distance: 'all' }), true);
    assert.equal(await accepts({ distance: '5', origin: [42.4, 19.2] }), true);
    assert.equal(await accepts({ distance: '5', origin: { lat: 42.4, lng: 19.2 } }), true);
    for (const origin of [undefined, null, [], [42.4], [null, 19.2], ['bad', 19.2], [91, 19.2], [42.4, 181], {}, { lat: 42.4 }, { lat: null, lng: 19.2 }, { lat: 'bad', lng: 19.2 }]) assert.equal(await accepts({ distance: '5', origin }), false, JSON.stringify(origin));
    assert.equal(await accepts({ distance: '5', origin: [42.4, 19.2] }, 44, 21), false);
    assert.equal(await accepts({ distance: '5', origin: [42.4, 19.2] }, null, null), false);
  });
  await check('digest failure leaves the checkpoint untouched, retries after backoff and empty matches create no fake notification', async () => {
    await db.query("insert into public.saved_searches(user_id,query,filters) values($1,'no-such-result','{}')", [owner]);
    const [job] = await service('claim_daily_digest_jobs', [10]); assert.ok(job);
    assert.equal(await service('finish_daily_digest_job', [job.id, job.lease_token, null, 'processing_failed']), true);
    assert.equal((await db.query('select last_digest_at from public.saved_searches where user_id=$1', [owner])).rows[0].last_digest_at, null);
    assert.equal((await service('claim_daily_digest_jobs', [10])).length, 0);
    await db.query("update notifications_private.digest_jobs set next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
    const [retry] = await service('claim_daily_digest_jobs', [10]); assert.notEqual(retry.lease_token, job.lease_token);
    assert.equal(await service('finish_daily_digest_job', [job.id, job.lease_token, '[]', null]), false);
    await db.query("update notifications_private.digest_jobs set leased_until=now()-interval '1 second' where id=$1", [job.id]);
    const [reclaimed] = await service('claim_daily_digest_jobs', [10]); assert.notEqual(reclaimed.lease_token, retry.lease_token);
    assert.equal(await service('finish_daily_digest_job', [job.id, retry.lease_token, '[]', null]), false);
    const before = Number((await db.query('select count(*) as count from public.user_inbox where user_id=$1', [owner])).rows[0].count);
    await service('finish_daily_digest_job', [reclaimed.id, reclaimed.lease_token, '[]', null]);
    assert.ok((await db.query('select last_digest_at from public.saved_searches where user_id=$1', [owner])).rows[0].last_digest_at);
    assert.equal(Number((await db.query('select count(*) as count from public.user_inbox where user_id=$1', [owner])).rows[0].count), before);
    assert.equal((await service('claim_daily_digest_jobs', [10])).length, 0);
  });
  await check('private queue state is inaccessible to user roles and anonymous digest dispatch is denied', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(actor(role, owner, (tx) => tx.query('select * from notifications_private.deliveries')), (error) => error.code === '42501');
      await assert.rejects(actor(role, owner, (tx) => tx.query('select public.claim_daily_digest_jobs(10)')), (error) => error.code === '42501');
    }
  });
} finally { await db.close(); }
if (failed) process.exitCode = 1;
else console.log(`Notification SQL: ${passed} checks passed. PGlite uses one serialized connection; cross-session contention and live provider delivery are not claimed.`);
