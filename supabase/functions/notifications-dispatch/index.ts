import webpush from 'npm:web-push@3.6.7';
import { createPushSender } from './logic.mjs';
import { createNotificationHandler } from './handler.mjs';
import { createRpcClient } from './rpc.mjs';

const config = {
  schedulerSecret: Deno.env.get('NOTIFICATIONS_SECRET') || '',
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || '',
  subject: Deno.env.get('VAPID_SUBJECT') || '',
};
const callRpc = createRpcClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
Deno.serve(createNotificationHandler({ config, callRpc, send: createPushSender(webpush, { publicKey: config.publicKey, privateKey: config.privateKey, subject: config.subject }) }));
