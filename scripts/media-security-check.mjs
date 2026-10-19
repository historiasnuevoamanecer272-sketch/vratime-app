import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as magick from '../supabase/functions/media-upload/vendor/magick.mjs';
import { createMediaUploadHandler } from '../supabase/functions/media-upload/handler.mjs';
import { createImageProcessor, IMAGE_POLICY } from '../supabase/functions/media-upload/processor.mjs';
import { inspectImage, INPUT_MAX, readBounded } from '../supabase/functions/media-upload/validation.mjs';
import { runMediaCleanup } from '../supabase/functions/media-upload/cleanup-dry-run.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const staged = path.resolve(repo, '../vratime-staged-20261019');
const pgRequire = createRequire(path.join(staged, '.private-pg-tools/package.json'));
const { PGlite } = pgRequire('@electric-sql/pglite');
const functionDir = path.join(repo,'supabase/functions/media-upload');
// Execute the actual entrypoint in Node with only Deno file/env/serve boundaries
// shimmed. This proves its real URL loads the vendored WASM; it is not Edge QA.
const previousDeno=globalThis.Deno;
let entrypointHandler;
globalThis.Deno={readFile:async(url)=>new Uint8Array(await fs.readFile(url)),env:{get:()=>''},serve:(handler)=>{entrypointHandler=handler;}};
try { await import(pathToFileURL(path.join(functionDir,'index.ts')).href); }
finally { if (previousDeno===undefined) delete globalThis.Deno; else globalThis.Deno=previousDeno; }
const { ImageMagick, MagickFormat } = magick;
const processImage = createImageProcessor(magick);
const crc32 = (bytes) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
const chunk = (name,data) => { const type = Buffer.from(name), result = Buffer.alloc(data.length+12); result.writeUInt32BE(data.length); type.copy(result,4); data.copy(result,8); result.writeUInt32BE(crc32(Buffer.concat([type,data])),data.length+8); return result; };
const ihdr = Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]);
const seed = new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,57,119,69]))),chunk('IEND',Buffer.alloc(0))]));
const solid = (format, w = 900, h = 600) => ImageMagick.read(seed, (image) => { const geometry = new magick.MagickGeometry(w,h); geometry.ignoreAspectRatio = true; image.resize(geometry); image.comment = 'GPSLatitude=47; GPSLongitude=19; PRIVATE'; return image.write(format, (bytes) => new Uint8Array(bytes)); });
const png = solid(MagickFormat.Png), jpeg = solid(MagickFormat.Jpeg), webp = solid(MagickFormat.WebP);
const results = [];
const failures = [];
const check = async (name, run) => { try { await run(); results.push(name); } catch(error) { if (!process.argv.includes('--review-red')) throw error; failures.push({name,error:error.message}); } };
await check('Vendored startup WASM path, checksums and local static asset budget', async () => {
  assert.equal(typeof entrypointHandler,'function');
  const manifest = JSON.parse(await fs.readFile(path.join(functionDir,'vendor/provenance.json'),'utf8'));
  assert.equal(manifest.version,'0.0.45');
  for (const [file,proof] of Object.entries(manifest.files)) {
    const bytes = await fs.readFile(path.join(functionDir,file));
    assert.equal(bytes.length,proof.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'),proof.sha256);
  }
  const index = await fs.readFile(path.join(functionDir,'index.ts'),'utf8');
  assert.ok(index.includes("new URL('./magick.wasm', import.meta.url)")); assert.ok(!index.includes('npm:'));
  assert.equal(magick.ConfigurationFiles.default.policy.data,IMAGE_POLICY);
  const toml = await fs.readFile(path.join(repo,'supabase/config.toml'),'utf8');
  assert.ok(toml.includes('[functions.media-upload]')); assert.ok(toml.includes('./functions/media-upload/magick.wasm'));
  const walk = async (dir) => (await Promise.all((await fs.readdir(dir,{withFileTypes:true})).map(async (entry)=>entry.isDirectory()?walk(path.join(dir,entry.name)):(await fs.stat(path.join(dir,entry.name))).size))).flat(Infinity);
  const bytes = (await walk(functionDir)).reduce((sum,n)=>sum+n,0);
  assert.ok(bytes<20_000_000,`Local function assets exceed 20MB: ${bytes}`);
});
await check('Real WASM decodes JPEG/PNG/WebP, strips metadata and resizes', () => {
  for (const [bytes, type] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
    const avatar = processImage(bytes, 'avatar', type);
    assert.equal(avatar.width, 512); assert.equal(avatar.height, 512); assert.ok(avatar.bytes.length <= 524288);
    ImageMagick.read(avatar.bytes, (image) => { assert.equal(image.format, 'JPEG'); assert.equal(image.width, 512); assert.equal(image.profileNames.length, 0); assert.equal(image.comment, null); });
    const listing = processImage(bytes, 'listing', type);
    assert.ok(Math.max(listing.width, listing.height) <= 1600); assert.ok(listing.bytes.length <= 2097152);
  }
  const large = solid(MagickFormat.Jpeg, 2000, 1200);
  assert.equal(processImage(large, 'listing', 'image/jpeg').width, 1600);
  // A real EXIF APP1 block: little-endian TIFF IFD with orientation 6 (90°).
  const exif = Buffer.from([69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const app1 = Buffer.alloc(exif.length+4); app1[0]=255; app1[1]=225; app1.writeUInt16BE(exif.length+2,2); exif.copy(app1,4);
  const oriented = new Uint8Array(Buffer.concat([jpeg.subarray(0,2),app1,jpeg.subarray(2)]));
  ImageMagick.read(oriented,(image)=>assert.ok(image.profileNames.includes('exif')));
  const corrected = processImage(oriented,'listing','image/jpeg');
  assert.equal(corrected.width,600); assert.equal(corrected.height,900);
  ImageMagick.read(corrected.bytes,(image)=>assert.equal(image.profileNames.length,0));
});
await check('Forged MIME/video, pixel bombs and signature-only fake images rejected', () => {
  assert.throws(() => processImage(jpeg, 'listing', 'image/png'), /media_type_mismatch/);
  assert.throws(() => processImage(new TextEncoder().encode('....ftypisom fake video'), 'listing', 'image/jpeg'), /media_unsupported_type/);
  const bomb = new Uint8Array(png); new DataView(bomb.buffer).setUint32(16, 100000);
  assert.throws(() => inspectImage(bomb, 'image/png'), /media_pixel_limit/);
  const fake = new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',Buffer.from([1,2,3,4])),chunk('IEND',Buffer.alloc(0))]));
  assert.equal(inspectImage(fake,'image/png').width,1); // Signature/preflight alone accepts it.
  assert.throws(() => processImage(fake, 'listing', 'image/png'), /media_invalid_image/);
  assert.throws(() => inspectImage(new Uint8Array(INPUT_MAX + 1), 'image/png'), /media_input_too_large/);
  const apng = new Uint8Array(Buffer.concat([seed.subarray(0,33),chunk('acTL',Buffer.from([0,0,0,2,0,0,0,0])),seed.subarray(33)]));
  assert.throws(()=>inspectImage(apng,'image/png'),/media_animation_not_allowed/);
  const animatedWebp = Buffer.alloc(30); animatedWebp.write('RIFF'); animatedWebp.writeUInt32LE(22,4); animatedWebp.write('WEBPVP8X',8); animatedWebp.writeUInt32LE(10,16); animatedWebp[20]=2;
  assert.throws(()=>inspectImage(animatedWebp,'image/webp'),/media_animation_not_allowed/);
});
await check('Streaming body bound and timeout', async () => {
  await assert.rejects(() => readBounded(new Request('https://offline.test', { method: 'POST', body: new Uint8Array(20) }), 10), /media_input_too_large/);
  const body = new ReadableStream({ start() {} });
  await assert.rejects(() => readBounded(new Request('https://offline.test', { method: 'POST', body, duplex: 'half' }), 10, 15), /media_request_timeout/);
});

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = uid(1), foreign = uid(2), staff = uid(3), quotaUser = uid(4), rateUser = uid(5), concurrentUser = uid(6);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
create table public.profiles(id uuid primary key, avatar_url text, app_role text default 'user');
create table public.listings(id uuid primary key default gen_random_uuid(),user_id uuid, image_url text,image_urls jsonb default '[]');
create table public.user_feedback(id uuid primary key default gen_random_uuid(),user_id uuid,screenshot_url text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,created_at timestamptz default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated,service_role; grant select on storage.objects to anon;
grant all on public.profiles,public.listings,public.user_feedback to authenticated,service_role;
create policy existing_permissive on storage.objects for all to authenticated using(true) with check(true);
create policy public_photos on storage.objects for select to anon using(bucket_id in ('LISTING-PHOTOS','AVATARS'));
insert into storage.buckets(id,name,public) values('AVATARS','AVATARS',true),('LISTING-PHOTOS','LISTING-PHOTOS',true);
insert into public.profiles(id,app_role) values('${owner}','user'),('${foreign}','user'),('${staff}','admin'),('${quotaUser}','user'),('${rateUser}','user'),('${concurrentUser}','user');
update public.profiles set avatar_url='https://project.test/storage/v1/object/public/AVATARS/${foreign}/protected.png?cache=1#preview' where id='${foreign}';
insert into public.listings(id,user_id,image_url,image_urls) values('${uid(90)}','${owner}','https://old.invalid/photo.png','["https://old.invalid/photo.png"]');
insert into storage.objects(bucket_id,name,owner_id,metadata,created_at) values('AVATARS','${owner}/old.png','${owner}','{"size":1000,"mimetype":"image/png"}',now()-interval '10 days'),
('LISTING-PHOTOS','${quotaUser}/old.jpg','${quotaUser}','{"size":104857599,"mimetype":"image/jpeg"}',now());
insert into storage.objects(bucket_id,name,owner_id,metadata,created_at) values('AVATARS','${foreign}/protected.png','${foreign}','{"size":1000,"mimetype":"image/png"}',now()-interval '10 days');
`);
await db.exec(await fs.readFile(path.join(repo,'supabase/migrations/20261019064710_avatar_owner_read_for_upload.sql'),'utf8'));
await db.exec(await fs.readFile(path.join(repo,'supabase/migrations/20261019072832_secure_user_media_pipeline.sql'),'utf8'));
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const service = async (run) => { await db.exec('set role service_role'); try { return await run(); } finally { await db.exec('reset role'); } };
const actor = async (who, run, role = 'authenticated') => { await db.exec(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]); try { return await run(); } finally { await db.exec('reset role'); } };
const reserve = async (who, op, kind = 'listing', hash = 'a'.repeat(64)) => (await one('select public.media_reserve_upload($1,$2,$3,$4) as result',[who,op,kind,hash])).result;
const complete = async (who, asset, kind) => {
  const bucket = {avatar:'AVATARS', listing:'LISTING-PHOTOS', feedback:'FEEDBACK-ATTACHMENTS'}[kind];
  const url = kind === 'feedback' ? `media:${asset.assetId}` : `https://project.test/storage/v1/object/public/${bucket}/${asset.path}`;
  await db.query('select public.media_prepare_upload($1,$2,$3,$4,$5)',[who,asset.assetId,asset.claimToken,100,'b'.repeat(64)]);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,asset.path,{size:100,mimetype:'image/jpeg'}]);
  return (await one('select public.media_complete_upload($1,$2,$3,$4,$5) as result',[who,asset.assetId,asset.claimToken,100,url])).result;
};
let listingAsset, avatarAsset, feedbackAsset;
await check('SQL exact migration: complete/idempotent/ownership and private signing lookup', () => service(async () => {
  const reserved = await reserve(owner,uid(101)); listingAsset = await complete(owner,reserved,'listing');
  assert.equal(listingAsset.status,'complete');
  const duplicate = await reserve(owner,uid(101)); assert.equal(duplicate.assetId,listingAsset.assetId); assert.equal(duplicate.status,'complete');
  assert.equal((await reserve(owner,uid(101),'avatar')).error,'media_operation_conflict');
  assert.equal((await reserve(foreign,uid(101))).status,'reserved');
  avatarAsset = await complete(owner,await reserve(owner,uid(102),'avatar'),'avatar');
  feedbackAsset = await complete(owner,await reserve(owner,uid(103),'feedback'),'feedback');
  assert.equal((await one('select public.media_private_asset($1,$2) as result',[foreign,feedbackAsset.assetId])).result,null);
  assert.ok((await one('select public.media_private_asset($1,$2) as result',[owner,feedbackAsset.assetId])).result.path);
  assert.ok((await one('select public.media_private_asset($1,$2) as result',[staff,feedbackAsset.assetId])).result.path);
}));
await check('SQL quota includes existing files and active reservations; 30/hour', () => service(async () => {
  assert.equal((await reserve(quotaUser,uid(110))).error,'media_quota_exceeded');
  for (let i = 0; i < 30; i++) assert.equal((await reserve(rateUser,uid(200+i))).status,'reserved');
  assert.equal((await reserve(rateUser,uid(230))).error,'media_rate_limit');
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['LISTING-PHOTOS',`${concurrentUser}/old.jpg`,{size:100*1024*1024-2*1024*1024,mimetype:'image/jpeg'}]);
  const simultaneous = await Promise.all([reserve(concurrentUser,uid(240)),reserve(concurrentUser,uid(241))]);
  assert.equal(simultaneous.filter((r)=>r.status==='reserved').length,1);
  assert.equal(simultaneous.filter((r)=>r.error==='media_quota_exceeded').length,1);
}));
await check('SQL user cannot call admin RPC or bypass upload policies; private reads denied', async () => {
  await actor(owner,async () => {
    await assert.rejects(() => reserve(owner,uid(250)),/permission denied/);
    await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name) values('LISTING-PHOTOS',$1)",[`${owner}/bypass.jpg`]),/row-level security/);
    await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name) values('AVATARS',$1)",[`${owner}/bypass.jpg`]),/row-level security/);
    assert.equal((await one("select count(*)::int as count from storage.objects where bucket_id='FEEDBACK-ATTACHMENTS'")).count,0);
    assert.equal((await one("select count(*)::int as count from storage.objects where bucket_id='AVATARS' and owner_id=$1",[owner])).count,1);
    assert.equal((await one("select count(*)::int as count from storage.objects where bucket_id='AVATARS' and name=$1",[avatarAsset.path])).count,1);
    assert.equal((await db.query("update storage.objects set metadata='{}' where bucket_id='AVATARS' returning id")).rows.length,0);
    assert.equal((await db.query("delete from storage.objects where bucket_id='AVATARS' returning id")).rows.length,0);
  });
  await actor('',async () => assert.equal((await one("select count(*)::int as count from storage.objects where bucket_id='FEEDBACK-ATTACHMENTS'")).count,0),'anon');
});
await check('New service-owned avatar metadata reads work without a permissive legacy SELECT',async()=>{
  await db.exec('drop policy existing_permissive on storage.objects');
  await actor(owner,async()=>{
    assert.equal((await one("select count(*)::int as n from storage.objects where bucket_id='AVATARS' and name=$1",[avatarAsset.path])).n,1);
    assert.equal((await one("select count(*)::int as n from storage.objects where bucket_id='AVATARS' and name=$1",[`${foreign}/protected.png`])).n,0);
  });
  await db.exec('create policy existing_permissive on storage.objects for all to authenticated using(true) with check(true)');
});
await check('SQL five-photo trigger, foreign refs, legacy preservation, avatar and feedback validation', async () => {
  await actor(owner,async () => {
    await db.query('insert into public.listings(user_id,image_url,image_urls) values($1,$2,$3)',[owner,listingAsset.url,[listingAsset.url]]);
    await assert.rejects(() => db.query('insert into public.listings(user_id,image_urls) values($1,$2)',[owner,Array(6).fill(listingAsset.url)]),/media_photo_limit/);
    await assert.rejects(() => db.query('insert into public.listings(user_id,image_urls) values($1,$2)',[foreign,[listingAsset.url]]),/media_unowned_listing_photo/);
    await db.query('update public.listings set image_urls=image_urls where id=$1',[uid(90)]);
    await db.query('update public.profiles set avatar_url=$1 where id=$2',[avatarAsset.url,owner]);
    await assert.rejects(() => db.query('update public.profiles set avatar_url=$1 where id=$2',[avatarAsset.url,foreign]),/media_unowned_avatar/);
    await db.query('insert into public.user_feedback(user_id,screenshot_url) values($1,$2)',[owner,feedbackAsset.url]);
    await assert.rejects(() => db.query('insert into public.user_feedback(user_id,screenshot_url) values($1,$2)',[foreign,feedbackAsset.url]),/media_unowned_feedback/);
    await assert.rejects(() => db.query('insert into public.user_feedback(user_id,screenshot_url) values($1,$2)',[owner,listingAsset.url]),/media_unowned_feedback/);
  });
});
await check('Dry-run cleanup honors legacy query/fragment references and age', () => service(async () => {
  const before = (await one('select count(*)::int as count from storage.objects')).count;
  const candidates = (await db.query('select * from public.media_cleanup_candidates(0)')).rows;
  assert.equal(candidates.length,1); assert.equal(candidates[0].path,`${owner}/old.png`);
  assert.equal((await one('select count(*)::int as count from storage.objects')).count,before);
}));

await check('Recovery: expired reservation reclaims same path with fresh claim token', () => service(async () => {
  const first = await reserve(owner,uid(501));
  await db.query("update media_private.assets set expires_at=now()-interval '1 second' where id=$1",[first.assetId]);
  const retry = await reserve(owner,uid(501));
  assert.equal(retry.status,'reserved'); assert.equal(retry.path,first.path); assert.notEqual(retry.claimToken,first.claimToken);
  const stale = (await one('select public.media_complete_upload($1,$2,$3,$4,$5) as result',[owner,first.assetId,first.claimToken,100,'https://project.test/stale'])).result;
  assert.equal(stale.error,'media_not_found');
}));
await check('Recovery: failed reservation retries same operation and meters each attempt', () => service(async () => {
  const first = await reserve(owner,uid(502));
  await db.query('select public.media_fail_upload($1,$2,$3)',[owner,first.assetId,first.claimToken]);
  const retry = await reserve(owner,uid(502));
  assert.equal(retry.status,'reserved'); assert.equal(retry.assetId,first.assetId); assert.notEqual(retry.claimToken,first.claimToken);
  assert.equal((await one('select count(*)::int as n from media_private.upload_attempts where asset_id=$1',[first.assetId])).n,2);
}));
await check('Recovery: ambiguous stored upload is reconciled from persisted output identity', () => service(async () => {
  const first = await reserve(owner,uid(503));
  await db.query('select public.media_prepare_upload($1,$2,$3,$4,$5)',[owner,first.assetId,first.claimToken,100,'b'.repeat(64)]);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('LISTING-PHOTOS',$1,'{\"size\":100,\"mimetype\":\"image/jpeg\"}')",[first.path]);
  await db.query("update media_private.assets set expires_at=now()-interval '1 second' where id=$1",[first.assetId]);
  const retry = await reserve(owner,uid(503));
  assert.equal(retry.status,'reconcile'); assert.equal(retry.path,first.path); assert.equal(retry.outputHash,'b'.repeat(64)); assert.equal(retry.outputBytes,100);
  const done = (await one('select public.media_complete_upload($1,$2,$3,$4,$5) as result',[owner,retry.assetId,retry.claimToken,100,`https://project.test/storage/v1/object/public/LISTING-PHOTOS/${retry.path}`])).result;
  assert.equal(done.status,'complete');
  assert.equal((await reserve(owner,uid(503))).status,'complete');
}));
await check('Recovery: reclaim near quota holds capacity once and rejects changed bytes', () => service(async () => {
  const who = uid(7); await db.query('insert into public.profiles(id) values($1)',[who]);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('LISTING-PHOTOS',$1,$2)",[`${who}/legacy.jpg`,{size:98*1024*1024,mimetype:'image/jpeg'}]);
  const first = await reserve(who,uid(504));
  await db.query("update media_private.assets set expires_at=now()-interval '1 second' where id=$1",[first.assetId]);
  const retry = await reserve(who,uid(504)); assert.equal(retry.status,'reserved');
  assert.equal((await reserve(who,uid(504),'listing','c'.repeat(64))).error,'media_operation_conflict');
  assert.equal((await reserve(who,uid(505))).error,'media_quota_exceeded');
}));
await check('Cleanup claims lock reference attachment, require age, reject stale tokens and tombstone deleted assets',async()=>{
  let asset,claim;
  await service(async()=>{
    assert.equal((await one('select public.media_claim_cleanup($1,7) as r',[avatarAsset.assetId])).r.error,'media_cleanup_too_recent');
    await db.query("update storage.objects set created_at=now()-interval '10 days' where name=$1",[avatarAsset.path]);
    assert.equal((await one('select public.media_claim_cleanup($1,7) as r',[avatarAsset.assetId])).r.error,'media_cleanup_referenced');
    asset=await complete(owner,await reserve(owner,uid(506),'avatar'),'avatar');
    await db.query("update storage.objects set created_at=now()-interval '10 days' where name=$1",[asset.path]);
    await db.query("update media_private.assets set created_at=now()-interval '10 days' where id=$1",[asset.assetId]);
    claim=(await one('select public.media_claim_cleanup($1,7) as r',[asset.assetId])).r; assert.equal(claim.status,'claimed');
    assert.equal((await one('select public.media_finish_cleanup($1,$2) as r',[asset.assetId,claim.claimToken])).r.error,'media_cleanup_storage_unconfirmed');
  });
  await actor(owner,async()=>{
    await assert.rejects(()=>db.query('update public.profiles set avatar_url=$1 where id=$2',[asset.url,owner]),/media_unowned_avatar/);
    await assert.rejects(()=>db.query('select public.media_claim_cleanup($1,7)',[asset.assetId]),/permission denied/);
  });
  await service(async()=>{
    await db.query("update media_private.assets set cleanup_expires_at=now()-interval '1 second' where id=$1",[asset.assetId]);
    const reclaimed=(await one('select public.media_claim_cleanup($1,7) as r',[asset.assetId])).r;
    assert.equal(reclaimed.status,'claimed'); assert.notEqual(reclaimed.claimToken,claim.claimToken);
    assert.equal((await one('select public.media_finish_cleanup($1,$2) as r',[asset.assetId,claim.claimToken])).r.error,'media_stale_claim');
    // This deletes only focused offline fixture metadata, never real Storage.
    await db.query('delete from storage.objects where name=$1',[asset.path]);
    assert.equal((await one('select public.media_finish_cleanup($1,$2) as r',[asset.assetId,reclaimed.claimToken])).r.status,'deleted');
    assert.equal((await reserve(owner,uid(506),'avatar')).error,'media_asset_removed');
  });
});
await check('Maintenance dry-run does not claim/delete; explicit execution uses fresh server claims',async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,method:init.method});
    if(url.endsWith('/media_cleanup_candidates')) return Response.json([{asset_id:uid(507),bucket:'AVATARS',path:'stale-report-path'},{asset_id:null,bucket:'AVATARS',path:'legacy.png'}]);
    if(url.endsWith('/media_claim_cleanup')) return Response.json({status:'claimed',assetId:uid(507),bucket:'AVATARS',path:`${owner}/${uid(507)}.jpg`,claimToken:uid(508)});
    if(init.method==='DELETE') { assert.deepEqual(JSON.parse(init.body),{prefixes:[`${owner}/${uid(507)}.jpg`]}); return Response.json([]); }
    if(url.endsWith('/media_finish_cleanup')) return Response.json({status:'deleted'});
    throw new Error('Unexpected maintenance boundary');
  };
  const operatorEnv={SUPABASE_URL:'https://project.test',SUPABASE_SERVICE_ROLE_KEY:'offline-only'};
  assert.equal((await runMediaCleanup({env:operatorEnv,fetchImpl})).deleted,0); assert.equal(calls.length,1);
  const report=await runMediaCleanup({env:operatorEnv,execute:true,fetchImpl}); assert.equal(report.deleted,1); assert.equal(report.actions[1].status,'legacy_requires_review');
  assert.equal(calls.filter((call)=>call.method==='DELETE').length,1);
});

const env = { SUPABASE_URL:'https://project.test', SUPABASE_ANON_KEY:'offline-anon', SUPABASE_SERVICE_ROLE_KEY:'offline-admin' };
let adminCalls = 0, uploadCalls = 0, processCalls = 0, currentUser = owner;
let storageFault = null, commitFault = false;
const storedBodies = new Map();
const fakeFetch = async (url, init) => {
  if (url.endsWith('/auth/v1/user')) return Response.json({id:currentUser});
  if (url.includes('/rest/v1/rpc/')) {
    adminCalls++;
    assert.equal(init.headers.Authorization,'Bearer offline-admin');
    const name = url.split('/').at(-1), body = JSON.parse(init.body);
    const args = Object.values(body);
    const placeholders = args.map((_,i)=>`$${i+1}`).join(',');
    const result = await service(async () => (await one(`select public.${name}(${placeholders}) as result`,args)).result);
    if (name==='media_complete_upload' && commitFault) { commitFault=false; throw new Error('Offline lost commit response'); }
    return Response.json(result);
  }
  if (url.includes('/storage/v1/object/sign/')) return Response.json({signedURL:`/object/sign/FEEDBACK-ATTACHMENTS/${owner}/private.jpg?token=offline`});
  if (url.includes('/storage/v1/object/')) {
    if (!init.method || init.method==='GET') return storedBodies.has(url)?new Response(storedBodies.get(url),{headers:{'content-type':'image/jpeg'}}):new Response(null,{status:404});
    uploadCalls++;
    if (storageFault==='before-write') { storageFault=null; throw new Error('Offline failed before write'); }
    const [bucket,...names] = url.split('/storage/v1/object/')[1].split('/');
    await service(() => db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,names.join('/'),{size:init.body.length,mimetype:'image/jpeg'}]));
    storedBodies.set(url,new Uint8Array(init.body));
    if (storageFault==='after-write') { storageFault=null; throw new Error('Offline lost storage acknowledgement'); }
    if (storageFault==='error-after-write') { storageFault=null; return new Response(null,{status:503}); }
    return Response.json({Key:'offline'});
  }
  throw new Error('Unexpected offline boundary');
};
const handler = createMediaUploadHandler({env,fetchImpl:fakeFetch,processImage:(...args)=>{processCalls++; return processImage(...args);}});
const request = (bytes = png, extra = {}) => new Request('https://project.test/functions/v1/media-upload',{method:'POST',body:bytes,headers:{authorization:'Bearer offline-user','content-type':'image/png','x-media-kind':'listing','x-operation-id':uid(800),...extra}});
await check('Handler real decode, immutable upload and retry idempotency', async () => {
  const res = await handler(request()); assert.equal(res.status,200,await res.clone().text());
  const first = await res.json(); assert.ok(first.url.startsWith('https://project.test/storage/v1/object/public/'));
  const retry = await handler(request()); assert.equal(retry.status,200); assert.deepEqual(await retry.json(),first);
  assert.equal(uploadCalls,1); assert.equal(processCalls,1);
});
await check('Handler unauthenticated/forged type/oversize input blocked before quota/storage', async () => {
  const calls = adminCalls;
  assert.equal((await handler(new Request('https://project.test',{method:'POST',body:png}))).status,401);
  assert.equal((await handler(request(png,{'content-type':'image/jpeg'}))).status,415);
  assert.equal((await handler(request(png,{'content-length':String(INPUT_MAX+1)}))).status,413);
  assert.equal(adminCalls,calls);
});
await check('Handler storage ambiguity, failed retry and lost commit recover without duplicate objects', async () => {
  const opRequest = (op)=>request(png,{'x-operation-id':uid(op)});
  storageFault='error-after-write';
  assert.equal((await handler(opRequest(810))).status,200);
  storageFault='after-write';
  assert.equal((await handler(opRequest(811))).status,503);
  const beforeRetryUploads=uploadCalls, beforeRetryDecode=processCalls;
  await db.query("update media_private.assets set expires_at=now()-interval '1 second' where operation_id=$1",[uid(811)]);
  const recovered = await handler(opRequest(811)); assert.equal(recovered.status,200,await recovered.clone().text());
  assert.equal(uploadCalls,beforeRetryUploads); assert.equal(processCalls,beforeRetryDecode);
  storageFault='before-write';
  assert.equal((await handler(opRequest(812))).status,503);
  assert.equal((await handler(opRequest(812))).status,200);
  commitFault=true;
  assert.equal((await handler(opRequest(813))).status,503);
  const beforeCommitRetryUploads=uploadCalls, beforeCommitRetryDecode=processCalls;
  assert.equal((await handler(opRequest(813))).status,200);
  assert.equal(uploadCalls,beforeCommitRetryUploads); assert.equal(processCalls,beforeCommitRetryDecode);
  storageFault='after-write';
  assert.equal((await handler(opRequest(814))).status,503);
  const badAsset=await one('select path from media_private.assets where operation_id=$1',[uid(814)]);
  const badUrl=`https://project.test/storage/v1/object/LISTING-PHOTOS/${badAsset.path}`;
  const badBytes=new Uint8Array(storedBodies.get(badUrl)); badBytes[badBytes.length-1]^=1; storedBodies.set(badUrl,badBytes);
  await db.query("update media_private.assets set expires_at=now()-interval '1 second' where operation_id=$1",[uid(814)]);
  const beforeTamperUploads=uploadCalls;
  const tamper=await handler(opRequest(814)); assert.equal(tamper.status,503); assert.equal((await tamper.json()).error,'media_reconciliation_required');
  assert.equal(uploadCalls,beforeTamperUploads);
});
await check('Browser helper binds expected owner, exact bearer and cancellation to upload',async()=>{
  const source=(await fs.readFile(path.join(repo,'src/lib/mediaUploads.js'),'utf8')).replace(/^import[^\n]+\n/,'').replace(/^export /gm,'');
  const calls=[];
  let session={user:{id:owner},access_token:'owner-bearer'};
  const stub={auth:{getSession:async()=>({data:{session}})},functions:{invoke:async(name,options)=>{calls.push({name,options}); return {data:{assetId:uid(850),url:'https://project.test/avatar',path:'avatar'}};}}};
  const helper=new Function('supabase',`${source}\nreturn {uploadUserMedia};`)(stub);
  const file=new Blob([png],{type:'image/png'});
  await assert.rejects(()=>helper.uploadUserMedia({kind:'avatar',file,expectedUserId:foreign}),/media_auth_changed/); assert.equal(calls.length,0);
  const abort=new AbortController(); abort.abort();
  await assert.rejects(()=>helper.uploadUserMedia({kind:'avatar',file,expectedUserId:owner,signal:abort.signal}),/media_auth_changed/); assert.equal(calls.length,0);
  await helper.uploadUserMedia({kind:'avatar',file,expectedUserId:owner}); assert.equal(calls[0].options.headers.Authorization,'Bearer owner-bearer');
  session={user:{id:foreign},access_token:'foreign-bearer'};
  await assert.rejects(()=>helper.uploadUserMedia({kind:'avatar',file,expectedUserId:owner}),/media_auth_changed/); assert.equal(calls.length,1);
  session={user:{id:owner},access_token:'captured-owner-bearer'};
  const switched=helper.uploadUserMedia({kind:'avatar',file,expectedUserId:owner});
  session={user:{id:foreign},access_token:'new-foreign-bearer'};
  await switched; assert.equal(calls[1].options.headers.Authorization,'Bearer captured-owner-bearer');
  session={user:{id:owner},access_token:'owner-bearer'};
  const activeAbort=new AbortController();
  stub.functions.invoke=async(name,options)=>{ assert.equal(options.signal,activeAbort.signal); activeAbort.abort(); return {data:{assetId:uid(851),url:'https://project.test/late',path:'late'}}; };
  await assert.rejects(()=>helper.uploadUserMedia({kind:'avatar',file,expectedUserId:owner,signal:activeAbort.signal}),/media_auth_changed/);
});
await check('Handler private links require authorized lookup and short-lived signing', async () => {
  const sign = () => new Request('https://project.test',{method:'POST',headers:{authorization:'Bearer offline-user','content-type':'application/json'},body:JSON.stringify({action:'sign',assetId:feedbackAsset.assetId})});
  const res = await handler(sign()); assert.equal(res.status,200); const body = await res.json(); assert.equal(body.expiresIn,300); assert.ok(body.url.includes('/object/sign/FEEDBACK-ATTACHMENTS/')); assert.ok(!body.url.includes('/object/public/'));
  currentUser=foreign; assert.equal((await handler(sign())).status,404); currentUser=owner;
});
await db.close();
console.log(JSON.stringify({status:failures.length?'failed':'passed',checks:results.length,results,failures,limits:{inputMiB:5,pixels:12000000,avatarKiB:512,photoMiB:2,userMiB:100,uploadsPerHour:30},liveEdgeExecuted:false},null,2));
if (failures.length) process.exitCode=1;
