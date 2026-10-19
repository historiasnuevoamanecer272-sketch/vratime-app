import { createFeedbackTelegramHandler } from './handler.mjs';

Deno.serve(createFeedbackTelegramHandler({ env: {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  TELEGRAM_BOT_TOKEN: Deno.env.get('VRATIME_TELEGRAM_BOT_TOKEN') || Deno.env.get('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHAT_ID: Deno.env.get('VRATIME_TELEGRAM_CHAT_ID') || Deno.env.get('TELEGRAM_CHAT_ID'),
} }));
