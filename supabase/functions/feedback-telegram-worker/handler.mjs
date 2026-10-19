import {createFeedbackTelegramDelivery} from '../feedback-telegram/handler.mjs';
import {readBounded} from '../media-upload/validation.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
function secretMatches(actual,expected){
  if(typeof expected!=='string'||expected.length<32||expected.length>256||actual.length!==expected.length)return false;
  let difference=0;for(let index=0;index<expected.length;index++)difference|=actual.charCodeAt(index)^expected.charCodeAt(index);
  return difference===0;
}

export function createFeedbackTelegramWorkerHandler({env,fetchImpl=globalThis.fetch}){
  const base=String(env.SUPABASE_URL??'').replace(/\/$/,'');
  const serviceKey=env.SUPABASE_SERVICE_ROLE_KEY,secret=env.FEEDBACK_WORKER_SECRET;
  const maximum=Math.max(1,Math.min(5,Number.parseInt(env.FEEDBACK_WORKER_MAX_BATCH??'5',10)||5));
  const deliveryEnv={...env,TELEGRAM_BOT_TOKEN:env.VRATIME_TELEGRAM_BOT_TOKEN||env.TELEGRAM_BOT_TOKEN,TELEGRAM_CHAT_ID:env.VRATIME_TELEGRAM_CHAT_ID||env.TELEGRAM_CHAT_ID};
  return async function worker(request){
    if(request.method!=='POST')return reply(405,{error:'worker_method_not_allowed'});
    if(!base||!serviceKey||!secret||secret.length<32||secret.length>256)return reply(503,{error:'worker_not_configured'});
    if(!secretMatches(request.headers.get('x-feedback-worker-secret')??'',secret))return reply(401,{error:'worker_unauthorized'});
    if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return reply(415,{error:'worker_json_required'});
    let body;
    try{body=JSON.parse(new TextDecoder().decode(await readBounded(request,256,2000)));}catch{return reply(400,{error:'worker_invalid_request'});}
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)return reply(400,{error:'worker_invalid_request'});
    const deadline=performance.now()+100000;
    const boundedFetch=async(url,init={})=>{
      const remaining=deadline-performance.now();if(remaining<=0)throw new Error('worker_time_budget');
      return fetchImpl(url,{...init,signal:AbortSignal.timeout(Math.max(1,Math.min(8000,Math.floor(remaining))))});
    };
    try{
      const response=await boundedFetch(`${base}/rest/v1/rpc/pending_feedback_telegram`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify({maximum}),redirect:'error'});
      if(!response.ok)return reply(503,{error:'worker_queue_unavailable'});
      const candidates=await response.json();if(!Array.isArray(candidates)||candidates.length>5)return reply(503,{error:'worker_invalid_queue'});
      const deliver=createFeedbackTelegramDelivery({env:deliveryEnv,fetchImpl:boundedFetch});
      const results=[];let unavailable=false;
      for(const candidate of candidates.slice(0,maximum)){
        if(deadline-performance.now()<44000)break; // Leave room for claim/asset lookup/sign/send/receipt within the existing lease.
        if(!UUID.test(candidate.feedback_id??'')||!UUID.test(candidate.user_id??''))return reply(503,{error:'worker_invalid_queue'});
        const delivered=await deliver(candidate.feedback_id,candidate.user_id);
        const receipt=await delivered.json();if(delivered.status>=500)unavailable=true;
        results.push({feedbackId:candidate.feedback_id,delivery:receipt.delivery??'unavailable',...(receipt.retryAfterSeconds?{retryAfterSeconds:receipt.retryAfterSeconds}:{}),...(receipt.duplicate?{duplicate:true}:{})});
      }
      return reply(unavailable?503:200,{processed:results.length,limit:maximum,continuationNeeded:results.length<candidates.length||candidates.length===maximum,results});
    }catch{return reply(503,{error:'worker_unavailable'});}
  };
}
