import { pathToFileURL } from 'node:url';

// Operator-only maintenance; dry-run is the default. No .env files are loaded.
export async function runMediaCleanup({ env, execute = false, fetchImpl = globalThis.fetch }) {
  const base = String(env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const secret = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\/[^/]+$/.test(base) || !secret) throw new Error('Set operator SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. No .env is read.');
  const headers = { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  async function rpc(name,args) {
    let response;
    try { response=await fetchImpl(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(10000),redirect:'error'}); }
    catch { throw new Error('Media maintenance request unavailable.'); }
    if (!response.ok) throw new Error(`Media maintenance failed (${response.status}).`);
    return response.json();
  }
  const candidates=await rpc('media_cleanup_candidates',{minimum_age_days:7});
  const report={mode:execute?'execute':'dry-run',deleted:0,minimumAgeDays:7,cappedAt:500,candidates,actions:[]};
  if (!execute) return report;
  for (const candidate of candidates) {
    // Legacy objects have no immutable managed ledger/claim. Never delete these
    // automatically; retain their report for a separate operator review.
    if (!candidate.asset_id) { report.actions.push({path:candidate.path,status:'legacy_requires_review'}); continue; }
    const claim=await rpc('media_claim_cleanup',{target_asset_id:candidate.asset_id,minimum_age_days:7});
    if (claim.status!=='claimed') { report.actions.push({assetId:candidate.asset_id,status:claim.error??claim.status}); continue; }
    // Do not trust stale report paths. Use the newly locked server claim only.
    if (!['AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS'].includes(claim.bucket) || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(claim.path)) throw new Error('Invalid managed cleanup claim.');
    let acknowledged=false;
    try {
      const removed=await fetchImpl(`${base}/storage/v1/object/${claim.bucket}`,{method:'DELETE',headers,body:JSON.stringify({prefixes:[claim.path]}),signal:AbortSignal.timeout(10000),redirect:'error'});
      acknowledged=removed.ok||removed.status===404;
    } catch { /* SQL verifies metadata absence even after an uncertain response. */ }
    const finish=await rpc('media_finish_cleanup',{target_asset_id:claim.assetId,claim_token:claim.claimToken});
    if (finish.status==='deleted') report.deleted++;
    report.actions.push({assetId:claim.assetId,path:claim.path,status:finish.status??finish.error,storageAcknowledged:acknowledged});
  }
  return report;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  const execute=args.includes('--execute')&&args.includes('--confirm-unreferenced-media-deletion');
  if (args.some((arg)=>!['--dry-run','--execute','--confirm-unreferenced-media-deletion'].includes(arg)) || (args.includes('--execute')&&!execute) || (execute&&args.includes('--dry-run'))) throw new Error('Use --dry-run (default), or explicitly --execute --confirm-unreferenced-media-deletion.');
  console.log(JSON.stringify(await runMediaCleanup({env:process.env,execute}),null,2));
}
