import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

const fetchWithTimeout = async (input, init = {}) => {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  const timeout = window.setTimeout(() => controller.abort(new Error('Request timed out')), 20000);

  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
};

const clientKey = '__vratimeSupabaseClient';
const existingClient = import.meta.env.DEV ? globalThis[clientKey] : null;

export const supabase = existingClient || createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});

if (import.meta.env.DEV) globalThis[clientKey] = supabase;
