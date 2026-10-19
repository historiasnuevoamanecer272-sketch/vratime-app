import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

const repo=path.resolve(import.meta.dirname,'..'),staged=path.resolve(repo,'../vratime-staged-20261019');
const require=createRequire(path.join(staged,'.private-pg-tools/package.json'));
const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
const uuid=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table public.user_feedback(id uuid primary key,user_id uuid not null,feedback_type text default 'problem',message text default 'Offline feedback',screenshot_url text,created_at timestamptz default now());`);
await db.exec(await fs.readFile(path.join(repo,'supabase/migrations/20261019062051_feedback_telegram_delivery_queue.sql'),'utf8'));
for(const file of (await fs.readdir(path.join(repo,'supabase/migrations'))).filter((name)=>name.endsWith('_feedback_telegram_background_worker.sql')))await db.exec(await fs.readFile(path.join(repo,'supabase/migrations',file),'utf8'));
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const results=[];const check=async(name,run)=>{await run();results.push(name);};
await check('Queue RPC bounds candidates to five IDs and derives owners from stored feedback',async()=>{
  assert.notEqual((await one("select to_regprocedure('public.pending_feedback_telegram(integer)')::text as fn")).fn,null,'Missing bounded server queue worker RPC');
  for(let n=1;n<=8;n++)await db.query('insert into public.user_feedback(id,user_id) values($1,$2)',[uuid(n),uuid(100+n)]);
  const pending=(await db.query('select * from public.pending_feedback_telegram(99)')).rows;
  assert.equal(pending.length,5);assert.equal(pending[0].user_id,uuid(101));
});
await check('Queue excludes future retries, exhausted/delivered/ambiguous rows and holds expired sends',async()=>{
  await db.exec('begin');
  try{
    await db.query("update public.feedback_telegram_deliveries set status='failed',next_attempt_at=now()+interval '1 hour' where feedback_id=$1",[uuid(1)]);
    await db.query("update public.feedback_telegram_deliveries set status='failed',attempts=5 where feedback_id=$1",[uuid(2)]);
    await db.query("update public.feedback_telegram_deliveries set status='ambiguous' where feedback_id=$1",[uuid(3)]);
    await db.query("update public.feedback_telegram_deliveries set status='sending',lease_expires_at=now()-interval '1 second' where feedback_id=$1",[uuid(4)]);
    await db.query("update public.feedback_telegram_deliveries set status='delivered',telegram_message_id='1',delivered_at=now() where feedback_id=$1",[uuid(5)]);
    const rows=(await db.query('select * from public.pending_feedback_telegram(5)')).rows;
    assert.deepEqual(rows.map((row)=>row.feedback_id),[uuid(6),uuid(7),uuid(8)]);
    assert.equal((await one('select status from public.feedback_telegram_deliveries where feedback_id=$1',[uuid(4)])).status,'ambiguous');
  }finally{await db.exec('rollback');}
  await db.exec('set role authenticated');
  try{await assert.rejects(()=>db.query('select * from public.pending_feedback_telegram(5)'),/permission denied/);}finally{await db.exec('reset role');}
});
const deliveryModule=await import('../supabase/functions/feedback-telegram/handler.mjs');
await check('Worker can reuse the real server delivery/signing/receipt implementation',async()=>{
  assert.equal(typeof deliveryModule.createFeedbackTelegramDelivery,'function','Missing shared server delivery factory');
});
let createFeedbackTelegramWorkerHandler;
try{({createFeedbackTelegramWorkerHandler}=await import('../supabase/functions/feedback-telegram-worker/handler.mjs'));}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
await check('Secret-gated background feedback worker exists',async()=>{assert.equal(typeof createFeedbackTelegramWorkerHandler,'function','Missing background feedback worker handler');});
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'offline-service',FEEDBACK_WORKER_SECRET:'0123456789abcdef0123456789abcdef',TELEGRAM_BOT_TOKEN:'123:offline_token',TELEGRAM_CHAT_ID:'777'};
let telegramCalls=0,rpcCalls=0,telegramMode='success',receiptFault=false,signedCalls=0;const texts=[];
const assetId=uuid(999);
await db.query('update public.user_feedback set screenshot_url=$1 where id=$2',[`media:${assetId}`,uuid(2)]);
const fetchImpl=async(url,init={})=>{
  if(url.includes('/rest/v1/rpc/')){
    rpcCalls++;assert.equal(init.headers.Authorization,'Bearer offline-service');const name=url.split('/').at(-1),body=JSON.parse(init.body),args=Object.values(body);
    if(name==='media_private_asset'){assert.deepEqual(body,{expected_user_id:uuid(102),target_asset_id:assetId});return Response.json({bucket:'FEEDBACK-ATTACHMENTS',path:`${uuid(102)}/${assetId}.jpg`});}
    if(name==='finish_feedback_telegram'&&receiptFault){receiptFault=false;throw new Error('Offline lost receipt');}
    if(name==='claim_feedback_telegram')assert.equal(body.expected_user_id,(await one('select user_id from public.user_feedback where id=$1',[body.target_feedback_id])).user_id);
    await db.exec('set role service_role');
    try{return name==='pending_feedback_telegram'?Response.json((await db.query('select * from public.pending_feedback_telegram($1)',args)).rows):Response.json((await one(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as r`,args)).r);}finally{await db.exec('reset role');}
  }
  if(url.includes('/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/')){signedCalls++;assert.equal(JSON.parse(init.body).expiresIn,300);return Response.json({signedURL:`/object/sign/FEEDBACK-ATTACHMENTS/${uuid(102)}/${assetId}.jpg?token=offline`});}
  if(url==='https://api.telegram.org/bot123:offline_token/sendMessage'){
    telegramCalls++;const body=JSON.parse(init.body);assert.equal(body.chat_id,'777');texts.push(body.text);
    if(telegramMode==='network')throw new Error('Offline unknown acknowledgement');
    if(telegramMode==='failure')return Response.json({ok:false,error_code:429,parameters:{retry_after:120}},{status:429});
    return Response.json({ok:true,result:{message_id:100+telegramCalls,chat:{id:777,type:'private'},date:1792390000,text:body.text}});
  }
  throw new Error('Unexpected offline worker HTTP boundary');
};
const request=(body={},secret=env.FEEDBACK_WORKER_SECRET)=>new Request('https://fixture.supabase.co/functions/v1/feedback-telegram-worker',{method:'POST',headers:{'content-type':'application/json','x-feedback-worker-secret':secret},body:JSON.stringify(body)});
await check('Only exact scheduler secret and empty bounded body authorize the worker',async()=>{
  const handler=createFeedbackTelegramWorkerHandler({env,fetchImpl}),before=rpcCalls;
  for(const secret of['',`prefix${env.FEEDBACK_WORKER_SECRET}`,'bad'])assert.equal((await handler(request({},secret))).status,401);
  assert.equal((await handler(request({userId:uuid(1)}))).status,400);
  assert.equal((await handler(request({url:'https://evil.invalid',recipient:'888'}))).status,400);
  assert.equal((await handler(request({padding:'x'.repeat(500)}))).status,400);
  assert.equal(rpcCalls,before);
});
await check('Worker processes five queued server IDs, signs private media and deduplicates receipts',async()=>{
  await db.exec('begin');
  try{
    const handler=createFeedbackTelegramWorkerHandler({env:{...env,FEEDBACK_WORKER_MAX_BATCH:'99'},fetchImpl}),before=telegramCalls;
    const response=await handler(request());assert.equal(response.status,200);const report=await response.json();assert.equal(report.processed,5);assert.equal(report.continuationNeeded,true);assert.equal(telegramCalls-before,5);assert.ok(report.results.every((item)=>item.delivery==='delivered'));assert.equal(signedCalls,1);
    assert.ok(texts.some((text)=>text.includes('/storage/v1/object/sign/FEEDBACK-ATTACHMENTS/')));
    assert.equal((await one("select count(*)::int as n from public.feedback_telegram_deliveries where status='delivered'")).n,5);
    assert.equal((await (await handler(request())).json()).processed,3);
    assert.equal((await (await handler(request())).json()).processed,0);assert.equal(telegramCalls-before,8);
  }finally{await db.exec('rollback');}
});
await check('Background retries obey backoff and leave unknown acknowledgements held',async()=>{
  await db.exec('begin');
  try{
    await db.query("update public.feedback_telegram_deliveries set status='ambiguous' where feedback_id<>$1",[uuid(1)]);
    const handler=createFeedbackTelegramWorkerHandler({env,fetchImpl});telegramMode='failure';
    assert.equal((await (await handler(request())).json()).results[0].delivery,'queued');assert.equal((await one('select status from public.feedback_telegram_deliveries where feedback_id=$1',[uuid(1)])).status,'failed');
    const before=telegramCalls;assert.equal((await (await handler(request())).json()).processed,0);assert.equal(telegramCalls,before);
    await db.query("update public.feedback_telegram_deliveries set next_attempt_at=now()-interval '1 second' where feedback_id=$1",[uuid(1)]);telegramMode='network';
    assert.equal((await (await handler(request())).json()).results[0].delivery,'ambiguous');const after=telegramCalls;
    assert.equal((await (await handler(request())).json()).processed,0);assert.equal(telegramCalls,after);
  }finally{telegramMode='success';await db.exec('rollback');}
});
await check('Lost delivery receipt cannot cause an immediate or expired-lease resend',async()=>{
  await db.exec('begin');
  try{
    await db.query("update public.feedback_telegram_deliveries set status='ambiguous' where feedback_id<>$1",[uuid(1)]);
    const handler=createFeedbackTelegramWorkerHandler({env,fetchImpl});receiptFault=true;
    assert.equal((await (await handler(request())).json()).results[0].delivery,'ambiguous');const before=telegramCalls;
    assert.equal((await (await handler(request())).json()).processed,0);
    await db.query("update public.feedback_telegram_deliveries set lease_expires_at=now()-interval '1 second' where feedback_id=$1",[uuid(1)]);
    assert.equal((await (await handler(request())).json()).processed,0);assert.equal(telegramCalls,before);assert.equal((await one('select status from public.feedback_telegram_deliveries where feedback_id=$1',[uuid(1)])).status,'ambiguous');
  }finally{receiptFault=false;await db.exec('rollback');}
});
await db.close();console.log(JSON.stringify({status:'passed',checks:results.length,results,liveTelegramCalls:0,liveDatabaseWrites:0},null,2));
