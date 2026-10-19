import { createDailyDigestHandler } from './handler.mjs';
import { createRpcClient } from '../notifications-dispatch/rpc.mjs';

Deno.serve(createDailyDigestHandler({
  schedulerSecret: Deno.env.get('DAILY_DIGEST_SECRET') || '',
  callRpc: createRpcClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''),
}));
