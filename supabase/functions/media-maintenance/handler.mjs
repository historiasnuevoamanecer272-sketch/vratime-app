import { readBounded } from '../media-upload/validation.mjs';

const BUCKETS=new Set(['AVATARS','LISTING-PHOTOS','FEEDBACK-ATTACHMENTS']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
function equalSecret(actual,expected){
  if(typeof expected!=='string'||expected.length<32||expected.length>256||actual.length!==expected.length)return false;
  let difference=0;for(let i=0;i<expected.length;i++)difference|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return difference===0;
}
function levelFor(usage,budget){return !budget?null:usage.knownBytes*100>=budget*95?95:usage.knownBytes*100>=budget*80?80:0;}

export function createMediaMaintenanceHandler({env,fetchImpl=globalThis.fetch}){
  const base=String(env.SUPABASE_URL??'').replace(/\/$/,'');
  let baseValid=false;
  try{const url=new URL(base);baseValid=url.origin===base&&!url.username&&!url.password&&(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','kong','supabase_kong'].includes(url.hostname)));}catch{/* Invalid operator configuration. */}
  const serviceKey=env.SUPABASE_SERVICE_ROLE_KEY;
  const schedulerSecret=env.MEDIA_MAINTENANCE_SECRET;
  const enabled=env.MEDIA_MAINTENANCE_EXECUTION_ENABLED==='true';
  const budgetText=String(env.MEDIA_STORAGE_BUDGET_BYTES??'');
  const budget=budgetText&&/^\d{1,16}$/.test(budgetText)?Number(budgetText):null;
  const budgetValid=!budgetText||(Number.isSafeInteger(budget)&&budget>0&&budget<=1_000_000_000_000_000);
  const maximum=Math.max(1,Math.min(5,Number.parseInt(env.MEDIA_MAINTENANCE_MAX_CLEANUP??'2',10)||2));
  const botToken=String(env.VRATIME_TELEGRAM_BOT_TOKEN||env.TELEGRAM_BOT_TOKEN||'');
  const chatId=String(env.VRATIME_TELEGRAM_CHAT_ID||env.TELEGRAM_CHAT_ID||'');
  const telegramConfigured=/^\d+:[A-Za-z0-9_-]+$/.test(botToken)&&/^-?[1-9]\d{0,19}$/.test(chatId);

  return async function maintenance(request){
    if(request.method!=='POST')return reply(405,{error:'maintenance_method_not_allowed'});
    if(!schedulerSecret||schedulerSecret.length<32||schedulerSecret.length>256||!baseValid||!serviceKey||!budgetValid)return reply(503,{error:'maintenance_not_configured'});
    if(!equalSecret(request.headers.get('x-media-maintenance-secret')??'',schedulerSecret))return reply(401,{error:'maintenance_unauthorized'});
    if(request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')return reply(415,{error:'maintenance_json_required'});
    let body;
    try{body=JSON.parse(new TextDecoder().decode(await readBounded(request,256,2000)));}
    catch{return reply(400,{error:'maintenance_invalid_request'});}
    if(!body||Array.isArray(body)||Object.keys(body).some((key)=>key!=='mode')||![undefined,'dry-run','run'].includes(body.mode))return reply(400,{error:'maintenance_invalid_request'});
    const mode=body.mode??'dry-run';
    if(mode==='run'&&!enabled)return reply(409,{error:'maintenance_execution_disabled'});
    const started=performance.now(),deadline=started+45000;
    const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'};
    function timeout(){const remaining=deadline-performance.now();if(remaining<=0)throw new Error('maintenance_timeout');return AbortSignal.timeout(Math.max(1,Math.min(4000,Math.floor(remaining))));}
    async function rpc(name,args={}){
      const response=await fetchImpl(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),signal:timeout(),redirect:'error'});
      if(!response.ok)throw new Error('maintenance_database_unavailable');
      return response.json();
    }
    try{
      const candidates=await rpc('media_cleanup_candidates',{minimum_age_days:7});
      if(!Array.isArray(candidates)||candidates.length>500)throw new Error('maintenance_invalid_candidates');
      const managed=candidates.filter((candidate)=>UUID.test(candidate.asset_id??''));
      const cleanup={minimumAgeDays:7,managedCandidates:managed.length,legacySkipped:candidates.length-managed.length,limit:maximum,deleted:0,actions:[]};
      if(mode==='run'){
        for(const candidate of managed.slice(0,maximum)){
          if(performance.now()-started>8000)break; // Leave room for three bounded cleanup calls and the monitor/receipt.
          const claim=await rpc('media_claim_cleanup',{target_asset_id:candidate.asset_id,minimum_age_days:7});
          if(claim?.status!=='claimed'){cleanup.actions.push({assetId:candidate.asset_id,status:claim?.error??'not_claimed'});continue;}
          if(!UUID.test(claim.assetId??'')||!UUID.test(claim.claimToken??'')||!BUCKETS.has(claim.bucket)||!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(claim.path??''))throw new Error('maintenance_invalid_claim');
          let acknowledged=false;
          try{
            const removed=await fetchImpl(`${base}/storage/v1/object/${claim.bucket}`,{method:'DELETE',headers,body:JSON.stringify({prefixes:[claim.path]}),signal:timeout(),redirect:'error'});
            acknowledged=removed.ok||removed.status===404;
          }catch{/* The claim remains protected until SQL confirms absence or a later run reclaims it. */}
          const finish=await rpc('media_finish_cleanup',{target_asset_id:claim.assetId,claim_token:claim.claimToken});
          if(finish?.status==='deleted')cleanup.deleted++;
          cleanup.actions.push({assetId:claim.assetId,status:finish?.status??finish?.error??'unconfirmed',storageAcknowledged:acknowledged});
        }
      }else cleanup.preview=managed.slice(0,maximum).map(({asset_id,bucket,path})=>({assetId:asset_id,bucket,path}));

      const storage=mode==='run'&&budget?await rpc('media_observe_storage',{storage_budget_bytes:budget}):await rpc('media_storage_usage');
      if(!Number.isSafeInteger(storage?.knownBytes)||storage.knownBytes<0||!Number.isSafeInteger(storage.unknownObjects)||storage.unknownObjects<0)throw new Error('maintenance_invalid_usage');
      storage.budgetBytes=budget;storage.usageComplete=storage.unknownObjects===0;
      if(mode==='dry-run')storage.level=levelFor(storage,budget);
      const report={mode,cleanup,storage,traffic:{status:'unavailable',reason:'Reliable egress/traffic telemetry is not connected; storage object bytes are not traffic.'},alert:{delivery:mode==='dry-run'?'dry-run':!budget?'budget_not_configured':'none'}};
      if(mode==='dry-run'||!budget)return reply(200,report);
      const claim=await rpc('media_claim_storage_alert',{is_configured:telegramConfigured});
      if(claim?.delivery!=='claimed'){report.alert=claim??{delivery:'unavailable'};return reply(200,report);}
      const receipt={target_alert_id:claim.alertId,claim_token:claim.claimToken,delivery_outcome:'ambiguous',error_code:'telegram_acknowledgement_unknown',message_id:null,retry_after_seconds:60};
      let acknowledged=false;
      try{
        const text=`VratiMe — Storage: порог ${claim.threshold}%\nМедиа в AVATARS, LISTING-PHOTOS, FEEDBACK-ATTACHMENTS: ${claim.knownBytes} байт${claim.unknownObjects?` (нижняя граница; неизвестен размер ${claim.unknownObjects} объектов)`:''}.\nНастроенный бюджет: ${claim.budgetBytes} байт.\nТрафик: надёжные метрики не подключены.\nСобытие: ${claim.alertId}`;
        const response=await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,link_preview_options:{is_disabled:true}}),signal:timeout(),redirect:'error'});
        const telegram=await response.json();
        if(response.ok&&telegram?.ok===true&&Number.isSafeInteger(telegram.result?.message_id)&&telegram.result.message_id>0&&String(telegram.result.chat?.id)===chatId){
          acknowledged=true;receipt.delivery_outcome='delivered';receipt.error_code=null;receipt.message_id=String(telegram.result.message_id);
        }else if(telegram?.ok===false&&Number.isInteger(telegram.error_code)){
          receipt.delivery_outcome='failed';receipt.error_code=`telegram_${Math.max(100,Math.min(599,telegram.error_code))}`;
          const delay=Number(telegram.parameters?.retry_after);if(Number.isFinite(delay))receipt.retry_after_seconds=Math.max(60,Math.min(86400,Math.ceil(delay)));
        }
      }catch{/* Never print network exceptions: Telegram URLs contain the bot token. */}
      try{
        const persisted=await rpc('media_finish_storage_alert',receipt);
        if(persisted!==true){report.alert={delivery:'receipt_pending',telegramAcknowledged:acknowledged};return reply(503,report);}
      }catch{report.alert={delivery:'receipt_pending',telegramAcknowledged:acknowledged};return reply(503,report);}
      report.alert={delivery:receipt.delivery_outcome,alertId:claim.alertId,...(acknowledged?{messageId:receipt.message_id}:{})};
      return reply(200,report);
    }catch{return reply(503,{error:'maintenance_unavailable'});}
  };
}
