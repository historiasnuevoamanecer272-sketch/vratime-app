import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const toolPath=process.argv.find(arg=>arg.startsWith('--pg-tools='))?.slice('--pg-tools='.length);
if(!toolPath)throw new Error('Usage: node scripts/avatar-storage-check.mjs --pg-tools=/absolute/path/to/@electric-sql/pglite [--output=/absolute/report.json]');
const require=createRequire(import.meta.url);
const {PGlite}=require(path.resolve(toolPath));
const old=await fs.readFile(new URL('../supabase/migrations/20260922000000_roles_moderation_reports_support.sql',import.meta.url),'utf8');
const patch=await fs.readFile(new URL('../supabase/migrations/20261019064710_avatar_owner_read_for_upload.sql',import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const result=[];
for(const phase of ['before','after']){
 const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;
 grant usage on schema auth,storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`);
 await db.exec(old.slice(old.indexOf('create policy avatars_owner_insert'),old.indexOf('revoke execute on function public.current_app_role')));
 await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('AVATARS',$1,$2,'{"version":1}'),('AVATARS',$3,$4,'{"version":1}'),('UNRELATED',$1,$2,'{"version":1}')`,[`${owner}/avatar.jpg`,owner,`${other}/avatar.jpg`,other]);
 if(phase==='after')await db.exec(patch);
 const tests=[];
 async function check(name,run){await db.exec('begin');try{await run();tests.push({name,passed:true})}catch(e){tests.push({name,passed:false,error:e.message,code:e.code})}finally{await db.exec('rollback')}}
 async function actor(role,id){await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id??''])}
 const upsert=(path,user=owner)=>db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('AVATARS',$1,$2,'{"version":2}') on conflict(bucket_id,name) do update set metadata=excluded.metadata returning name,metadata`,[path,user]);
 await check('first avatar upload succeeds with INSERT RETURNING',async()=>{await actor('authenticated',owner);const r=await upsert(`${owner}/avatar.png`);assert.equal(r.rows[0].name,`${owner}/avatar.png`)});
 await check('replacement succeeds and preserves its path',async()=>{await actor('authenticated',owner);const r=await upsert(`${owner}/avatar.jpg`);assert.equal(r.rows[0].metadata.version,2)});
 await check('owner can see only their avatar metadata',async()=>{await actor('authenticated',owner);const r=await db.query('select name from storage.objects');assert.deepEqual(r.rows.map(x=>x.name),[`${owner}/avatar.jpg`])});
 await check('foreign avatar cannot be replaced',async()=>{await actor('authenticated',owner);let e;try{await upsert(`${other}/avatar.jpg`)}catch(x){e=x}assert.equal(e?.code,'42501')});
 await check('owner cannot rename their avatar into a foreign folder',async()=>{await actor('authenticated',owner);let e,changed;try{changed=await db.query('update storage.objects set name=$1 where name=$2 returning name',[`${other}/stolen.jpg`,`${owner}/avatar.jpg`])}catch(x){e=x}if(e)assert.equal(e.code,'42501');else assert.equal(changed.rows.length,0)});
 await check('anonymous users cannot list avatar metadata',async()=>{await actor('anon',null);assert.equal((await db.query('select * from storage.objects')).rows.length,0)});
 await check('own metadata in unrelated buckets stays hidden',async()=>{await actor('authenticated',owner);assert.equal((await db.query("select * from storage.objects where bucket_id='UNRELATED'")).rows.length,0)});
 result.push({phase,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,tests});await db.close();
}
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice('--output='.length);
if(output)await fs.writeFile(path.resolve(output),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
assert.equal(result[1].failed,0,'Avatar policy regression remains');
