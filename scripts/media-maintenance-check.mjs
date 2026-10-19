import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const repo=path.resolve(import.meta.dirname,'..');
const staged=path.resolve(repo,'../vratime-staged-20261019');
const require=createRequire(path.join(staged,'.private-pg-tools/package.json'));
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create schema media_private;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,service_role;
grant usage on schema public,storage,media_private to service_role;
create table public.profiles(id uuid primary key,avatar_url text,app_role text default 'user');
create table public.listings(id uuid primary key,user_id uuid,image_url text,image_urls jsonb default '[]');
create table public.user_feedback(id uuid primary key,user_id uuid,screenshot_url text);
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text,name text,owner_id text,metadata jsonb,created_at timestamptz default now());
grant select,insert,update,delete on storage.objects to service_role;
insert into storage.objects(bucket_id,name,metadata) values
('AVATARS','one.jpg','{"size":300}'),('LISTING-PHOTOS','two.jpg','{"size":500}'),('FEEDBACK-ATTACHMENTS','three.jpg','{"size":100}'),('OTHER','ignore.bin','{"size":999999}');`);
await db.exec(await fs.readFile(path.join(repo,'supabase/migrations/20261019072832_secure_user_media_pipeline.sql'),'utf8'));
const migrations=(await fs.readdir(path.join(repo,'supabase/migrations'))).filter((name)=>name.endsWith('_media_maintenance_monitor.sql'));
for(const migration of migrations) await db.exec(await fs.readFile(path.join(repo,'supabase/migrations',migration),'utf8'));
const checkResults=[];
const check=async(name,run)=>{await run();checkResults.push(name);};
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
await check('Authoritative usage counts actual bytes only in the three media buckets',async()=>{
  const row=await one("select to_regprocedure('public.media_storage_usage()')::text as fn");
  assert.notEqual(row.fn,null,'Missing server-only storage usage monitor RPC');
  const usage=(await one('select public.media_storage_usage() as r')).r;
  assert.equal(usage.knownBytes,900);assert.equal(usage.objects,3);assert.equal(usage.unknownObjects,0);assert.equal(usage.buckets.length,3);
});
await check('Threshold observation deduplicates unchanged usage and re-arms after a real decrease',async()=>{
  await db.exec('begin');
  try {
    const first=(await one('select public.media_observe_storage($1) as r',[1000])).r;
    assert.equal(first.level,80);assert.ok(first.alertId);
    const repeat=(await one('select public.media_observe_storage($1) as r',[1000])).r;
    assert.equal(repeat.alertId,null);
    await db.exec("update storage.objects set metadata='{\"size\":400}' where bucket_id='AVATARS'");
    const high=(await one('select public.media_observe_storage($1) as r',[1000])).r;
    assert.equal(high.level,95);assert.notEqual(high.alertId,first.alertId);
    await db.exec("update storage.objects set metadata='{\"size\":0}' where bucket_id in('AVATARS','LISTING-PHOTOS')");
    assert.equal((await one('select public.media_observe_storage($1) as r',[1000])).r.level,0);
    await db.exec("update storage.objects set metadata='{\"size\":700}' where bucket_id='AVATARS'");
    const again=(await one('select public.media_observe_storage($1) as r',[1000])).r;
    assert.equal(again.level,80);assert.notEqual(again.alertId,first.alertId);
  } finally {await db.exec('rollback');}
});
await check('Budget increase supersedes a queued alert and unknown sizes cannot pretend usage fell',async()=>{
  await db.exec('begin');
  try {
    await one('select public.media_observe_storage(1000) as r');
    await one('select public.media_observe_storage(2000) as r');
    assert.equal((await one("select count(*)::int as n from media_private.storage_alerts where status='pending'")).n,0);
    await one('select public.media_observe_storage(1000) as r');
    await db.exec("update storage.objects set metadata='{}' where bucket_id='AVATARS'");
    const usage=(await one('select public.media_observe_storage(1000) as r')).r;
    assert.equal(usage.knownBytes,600);assert.equal(usage.unknownObjects,1);assert.equal(usage.level,80);assert.equal(usage.alertId,null);
  } finally {await db.exec('rollback');}
});
await check('Alert leases deduplicate delivery, retry only known failures, and record truthful receipts',async()=>{
  await db.exec('begin');
  try {
    await one('select public.media_observe_storage(1000) as r');
    const first=(await one('select public.media_claim_storage_alert(true) as r')).r;
    assert.equal(first.delivery,'claimed');assert.equal(first.attempts,1);
    assert.equal((await one('select public.media_claim_storage_alert(true) as r')).r.delivery,'in_progress');
    assert.equal((await one("select public.media_finish_storage_alert($1,$2,'delivered',null,'2000',60) as ok",[first.alertId,'00000000-0000-4000-8000-000000000001'])).ok,false);
    assert.equal((await one("select public.media_finish_storage_alert($1,$2,'failed','telegram_429',null,60) as ok",[first.alertId,first.claimToken])).ok,true);
    assert.equal((await one('select public.media_claim_storage_alert(true) as r')).r.delivery,'failed');
    await db.exec("update media_private.storage_alerts set next_attempt_at=now()-interval '1 second'");
    const retry=(await one('select public.media_claim_storage_alert(true) as r')).r;assert.equal(retry.attempts,2);
    assert.equal((await one("select public.media_finish_storage_alert($1,$2,'delivered',null,'2060',60) as ok",[retry.alertId,retry.claimToken])).ok,true);
    const duplicate=(await one('select public.media_claim_storage_alert(true) as r')).r;
    assert.equal(duplicate.delivery,'delivered');assert.equal(duplicate.messageId,'2060');assert.equal(duplicate.duplicate,true);
  } finally {await db.exec('rollback');}
});
await check('Unknown acknowledgement leases never resend; unconfigured alerts do not consume attempts',async()=>{
  await db.exec('begin');
  try {
    await one('select public.media_observe_storage(1000) as r');
    assert.equal((await one('select public.media_claim_storage_alert(false) as r')).r.delivery,'unconfigured');
    assert.equal((await one('select attempts from media_private.storage_alerts')).attempts,0);
    const claim=(await one('select public.media_claim_storage_alert(true) as r')).r;assert.equal(claim.delivery,'claimed');
    await db.exec("update media_private.storage_alerts set leased_until=now()-interval '1 second'");
    const unknown=(await one('select public.media_claim_storage_alert(true) as r')).r;
    assert.equal(unknown.delivery,'ambiguous');assert.equal(unknown.attempts,1);
  } finally {await db.exec('rollback');}
});
await check('Current crossing receipt is chosen by monotonic episode even when timestamps tie',async()=>{
  await db.exec('begin');
  try{
    await one('select public.media_observe_storage(1000)');
    const old=(await one('select public.media_claim_storage_alert(true) as r')).r;
    await one("select public.media_finish_storage_alert($1,$2,'delivered',null,'2062',60)",[old.alertId,old.claimToken]);
    await one('select public.media_observe_storage(2000)');await one('select public.media_observe_storage(1000)');
    const current=(await one('select public.media_claim_storage_alert(true) as r')).r;
    await one("select public.media_finish_storage_alert($1,$2,'failed','telegram_429',null,60)",[current.alertId,current.claimToken]);
    const receipt=(await one('select public.media_claim_storage_alert(true) as r')).r;
    assert.equal(receipt.alertId,current.alertId);assert.equal(receipt.delivery,'failed');
  }finally{await db.exec('rollback');}
});
await check('Explicit delivery failures stop after three attempts and monitor RPCs reject user roles',async()=>{
  await db.exec('begin');
  try{
    await one('select public.media_observe_storage(1000) as r');
    for(let attempt=1;attempt<=3;attempt++){
      const claim=(await one('select public.media_claim_storage_alert(true) as r')).r;assert.equal(claim.attempts,attempt);
      await one("select public.media_finish_storage_alert($1,$2,'failed','telegram_500',null,60)",[claim.alertId,claim.claimToken]);
      await db.exec("update media_private.storage_alerts set next_attempt_at=now()-interval '1 second'");
    }
    const exhausted=(await one('select public.media_claim_storage_alert(true) as r')).r;
    assert.equal(exhausted.delivery,'failed');assert.equal(exhausted.retryExhausted,true);assert.equal(exhausted.attempts,3);
  }finally{await db.exec('rollback');}
  await db.exec('set role authenticated');
  try{
    await assert.rejects(()=>one('select public.media_storage_usage()'),/permission denied/);
    await assert.rejects(()=>one('select public.media_observe_storage(1000)'),/permission denied/);
    await assert.rejects(()=>one('select public.media_claim_storage_alert(true)'),/permission denied/);
    await assert.rejects(()=>one('select * from media_private.storage_alerts'),/permission denied/);
  }finally{await db.exec('reset role');}
});
let createMediaMaintenanceHandler;
try {({createMediaMaintenanceHandler}=await import('../supabase/functions/media-maintenance/handler.mjs'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
await check('Scheduler maintenance handler is available for secret-gated dry-run',async()=>{
  assert.equal(typeof createMediaMaintenanceHandler,'function','Missing safe server maintenance endpoint');
});
const env={SUPABASE_URL:'https://project.test',SUPABASE_SERVICE_ROLE_KEY:'offline-service',MEDIA_MAINTENANCE_SECRET:'0123456789abcdef0123456789abcdef',MEDIA_MAINTENANCE_EXECUTION_ENABLED:'true',MEDIA_STORAGE_BUDGET_BYTES:'1000',VRATIME_TELEGRAM_BOT_TOKEN:'123:preferred_token',VRATIME_TELEGRAM_CHAT_ID:'777',TELEGRAM_BOT_TOKEN:'456:fallback_token',TELEGRAM_CHAT_ID:'888'};
let telegramMode='success',telegramCalls=0,deleteCalls=0,rpcCalls=0,lastTelegram,receiptFault=false;
const fetchImpl=async(url,init)=>{
  if(url.includes('/rest/v1/rpc/')){
    rpcCalls++;assert.equal(init.headers.Authorization,'Bearer offline-service');
    const name=url.split('/').at(-1),args=Object.values(JSON.parse(init.body));
    if(name==='media_finish_storage_alert'&&receiptFault){receiptFault=false;throw new Error('Offline receipt write unavailable');}
    if(name==='media_cleanup_candidates')return Response.json((await db.query('select * from public.media_cleanup_candidates($1)',args)).rows);
    return Response.json((await one(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).r);
  }
  if(url.startsWith('https://api.telegram.org/')){
    telegramCalls++;lastTelegram={url,body:JSON.parse(init.body)};
    if(telegramMode==='network')throw new Error('Offline ambiguous acknowledgement');
    if(telegramMode==='failure')return Response.json({ok:false,error_code:429,description:'Too many requests',parameters:{retry_after:120}},{status:429});
    return Response.json({ok:true,result:{message_id:2061,date:1792390000,chat:{id:url.includes('/bot456:fallback_token/')?888:777,type:'private'},text:'offline'}});
  }
  if(init.method==='DELETE'&&url==='https://project.test/storage/v1/object/AVATARS'){
    deleteCalls++;
    const paths=JSON.parse(init.body).prefixes;
    await db.query("delete from storage.objects where bucket_id='AVATARS' and name=$1",[paths[0]]);
    return Response.json([]);
  }
  throw new Error('Unexpected offline maintenance boundary');
};
const request=(body={},secret=env.MEDIA_MAINTENANCE_SECRET)=>new Request('https://project.test/functions/v1/media-maintenance',{method:'POST',headers:{'content-type':'application/json','x-media-maintenance-secret':secret},body:JSON.stringify(body)});
await check('Exact scheduler secret rejects missing/substring/user-supplied recipient before database access',async()=>{
  const handler=createMediaMaintenanceHandler({env,fetchImpl});const before=rpcCalls;
  assert.equal((await handler(request({},'bad'))).status,401);
  assert.equal((await handler(request({},`prefix${env.MEDIA_MAINTENANCE_SECRET}`))).status,401);
  assert.equal((await handler(new Request('https://project.test',{method:'POST',headers:{authorization:'Bearer offline-service',apikey:'offline-service','content-type':'application/json'},body:'{}'}))).status,401);
  assert.equal((await handler(request({chatId:'999'}))).status,400);
  assert.equal(rpcCalls,before);
});
await check('Default dry-run never sends alerts or claims/deletes assets and reports traffic gap',async()=>{
  const handler=createMediaMaintenanceHandler({env,fetchImpl});const beforeSend=telegramCalls,beforeDelete=deleteCalls;
  const response=await handler(request());assert.equal(response.status,200);const report=await response.json();
  assert.equal(report.mode,'dry-run');assert.equal(report.storage.knownBytes,900);assert.equal(report.traffic.status,'unavailable');
  assert.equal(telegramCalls,beforeSend);assert.equal(deleteCalls,beforeDelete);
  assert.equal((await one('select count(*)::int as n from media_private.storage_alerts')).n,0);
  const disabled=createMediaMaintenanceHandler({env:{...env,MEDIA_MAINTENANCE_EXECUTION_ENABLED:''},fetchImpl});
  assert.equal((await disabled(request({mode:'run'}))).status,409);
});
await check('Local Supabase internal HTTP origin is accepted only from the trusted environment',async()=>{
  const handler=createMediaMaintenanceHandler({env:{...env,SUPABASE_URL:'http://kong:8000'},fetchImpl});
  assert.equal((await handler(request())).status,200);
});
await check('Owner alert uses preferred env recipient, confirmed receipt and dedup on unchanged usage',async()=>{
  await db.exec('begin');
  try{
    telegramMode='success';const before=telegramCalls;const handler=createMediaMaintenanceHandler({env,fetchImpl});
    const first=await handler(request({mode:'run'}));assert.equal(first.status,200);assert.equal((await first.json()).alert.delivery,'delivered');
    assert.ok(lastTelegram.url.includes('/bot123:preferred_token/'));assert.equal(lastTelegram.body.chat_id,'777');assert.ok(!lastTelegram.body.text.includes('preferred_token'));
    const second=await handler(request({mode:'run'}));assert.equal(second.status,200);assert.equal((await second.json()).alert.delivery,'delivered');assert.equal(telegramCalls-before,1);
  }finally{await db.exec('rollback');}
});
await check('Generic bot keys are a fallback and a missing budget never invents a threshold',async()=>{
  await db.exec('begin');
  try{
    const fallback=createMediaMaintenanceHandler({env:{...env,VRATIME_TELEGRAM_BOT_TOKEN:'',VRATIME_TELEGRAM_CHAT_ID:''},fetchImpl});
    const response=await fallback(request({mode:'run'}));assert.equal((await response.json()).alert.delivery,'delivered');
    assert.ok(lastTelegram.url.includes('/bot456:fallback_token/'));assert.equal(lastTelegram.body.chat_id,'888');
  }finally{await db.exec('rollback');}
  const before=telegramCalls;
  const unbudgeted=createMediaMaintenanceHandler({env:{...env,MEDIA_STORAGE_BUDGET_BYTES:''},fetchImpl});
  const report=await (await unbudgeted(request({mode:'run'}))).json();assert.equal(report.alert.delivery,'budget_not_configured');assert.equal(report.storage.budgetBytes,null);assert.equal(telegramCalls,before);
});
await check('Telegram explicit failure retries but ambiguous acknowledgements are held without resend',async()=>{
  await db.exec('begin');
  try{
    const handler=createMediaMaintenanceHandler({env,fetchImpl});telegramMode='failure';
    assert.equal((await (await handler(request({mode:'run'}))).json()).alert.delivery,'failed');
    const before=telegramCalls;
    assert.equal((await (await handler(request({mode:'run'}))).json()).alert.delivery,'failed');assert.equal(telegramCalls,before);
    await db.exec("update media_private.storage_alerts set next_attempt_at=now()-interval '1 second'");telegramMode='network';
    assert.equal((await (await handler(request({mode:'run'}))).json()).alert.delivery,'ambiguous');
    const beforeAmbiguous=telegramCalls;
    assert.equal((await (await handler(request({mode:'run'}))).json()).alert.delivery,'ambiguous');assert.equal(telegramCalls,beforeAmbiguous);
  }finally{await db.exec('rollback');telegramMode='success';}
});
await check('Accepted Telegram message with lost receipt is reported pending and never blindly resent',async()=>{
  await db.exec('begin');
  try{
    telegramMode='success';receiptFault=true;const handler=createMediaMaintenanceHandler({env,fetchImpl});
    const response=await handler(request({mode:'run'}));assert.equal(response.status,503);const report=await response.json();
    assert.equal(report.alert.delivery,'receipt_pending');assert.equal(report.alert.telegramAcknowledged,true);
    const before=telegramCalls;
    assert.equal((await (await handler(request({mode:'run'}))).json()).alert.delivery,'in_progress');assert.equal(telegramCalls,before);
    await db.exec("update media_private.storage_alerts set leased_until=now()-interval '1 second'");
    assert.equal((await (await handler(request({mode:'run'}))).json()).alert.delivery,'ambiguous');assert.equal(telegramCalls,before);
  }finally{receiptFault=false;await db.exec('rollback');}
});
await check('Execution deletes at most two freshly claimed managed orphans and never a legacy object',async()=>{
  await db.exec('begin');
  try{
    const user='00000000-0000-4000-8000-000000000800';await db.query('insert into public.profiles(id) values($1)',[user]);
    for(let n=801;n<=805;n++){
      const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,name=`${user}/${id}.jpg`;
      await db.query("insert into media_private.assets(id,user_id,operation_id,kind,input_hash,bucket,path,status,reserved_bytes,bytes,url,created_at) values($1,$2,$1,'avatar',$3,'AVATARS',$4,'complete',524288,10,$5,now()-interval '8 days')",[id,user,'a'.repeat(64),name,`https://project.test/storage/v1/object/public/AVATARS/${name}`]);
      await db.query("insert into storage.objects(bucket_id,name,metadata,created_at) values('AVATARS',$1,'{\"size\":10,\"mimetype\":\"image/jpeg\"}',now()-interval '8 days')",[name]);
    }
    await db.exec("insert into storage.objects(bucket_id,name,metadata,created_at) values('AVATARS','legacy-orphan.png','{\"size\":20}',now()-interval '8 days')");
    const handler=createMediaMaintenanceHandler({env:{...env,MEDIA_STORAGE_BUDGET_BYTES:'100000'},fetchImpl});const before=deleteCalls;
    const response=await handler(request({mode:'run'}));assert.equal(response.status,200);const report=await response.json();
    assert.equal(report.cleanup.deleted,2);assert.equal(deleteCalls-before,2);assert.equal(report.cleanup.legacySkipped,1);
    assert.equal((await one("select count(*)::int as n from storage.objects where name='legacy-orphan.png'")).n,1);
    assert.equal((await one("select count(*)::int as n from media_private.assets where status='deleted'")).n,2);
  }finally{await db.exec('rollback');}
});
await db.close();
console.log(JSON.stringify({status:'passed',checks:checkResults.length,results:checkResults,liveTelegramCalls:0,liveDatabaseWrites:0},null,2));
