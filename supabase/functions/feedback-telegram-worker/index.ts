import {createFeedbackTelegramWorkerHandler} from './handler.mjs';

Deno.serve(createFeedbackTelegramWorkerHandler({env:{
  SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  FEEDBACK_WORKER_SECRET:Deno.env.get('FEEDBACK_WORKER_SECRET'),
  FEEDBACK_WORKER_MAX_BATCH:Deno.env.get('FEEDBACK_WORKER_MAX_BATCH'),
  TELEGRAM_BOT_TOKEN:Deno.env.get('VRATIME_TELEGRAM_BOT_TOKEN')||Deno.env.get('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHAT_ID:Deno.env.get('VRATIME_TELEGRAM_CHAT_ID')||Deno.env.get('TELEGRAM_CHAT_ID'),
}}));
