const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const utcDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const hasBearer = (request: Request, secret: string) => {
  const authorization = request.headers.get('authorization') || '';
  return authorization === `Bearer ${secret}` || request.headers.get('x-scheduler-secret') === secret;
};

const restHeaders = (serviceRoleKey: string) => ({
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
});

const selectJson = async (url: string, serviceRoleKey: string, path: string) => {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: restHeaders(serviceRoleKey) });
  if (!response.ok) throw new Error(`Database read failed: ${path} ${response.status}`);
  return response.json();
};

const insertJson = async (url: string, serviceRoleKey: string, path: string, body: unknown, prefer = 'return=representation') => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...restHeaders(serviceRoleKey), prefer },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Database insert failed: ${path} ${response.status}`);
  return response.status === 204 ? [] : response.json();
};

const patchJson = async (url: string, serviceRoleKey: string, path: string, body: unknown) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...restHeaders(serviceRoleKey), prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Database update failed: ${path} ${response.status}`);
};

const isValidSubscription = (subscription: Record<string, unknown>) => (
  subscription.enabled === true
  && typeof subscription.endpoint === 'string'
  && subscription.endpoint.startsWith('https://')
  && typeof subscription.p256dh === 'string'
  && subscription.p256dh.length >= 20
  && typeof subscription.auth === 'string'
  && subscription.auth.length >= 10
);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const schedulerSecret = Deno.env.get('DAILY_DIGEST_SECRET') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!schedulerSecret || !supabaseUrl || !serviceRoleKey) return json({ error: 'Daily digest is not configured' }, 503);
  if (!hasBearer(request, schedulerSecret)) return json({ error: 'Unauthorized' }, 401);

  const digestDate = utcDateKey();
  try {
    const searches = await selectJson(
      supabaseUrl,
      serviceRoleKey,
      `saved_searches?select=id,user_id,query,filters,last_digest_at&notify_daily=eq.true`,
    ) as Record<string, unknown>[];
    const users = new Map<string, Record<string, unknown>[]>();
    for (const search of searches) {
      const userId = String(search.user_id || '');
      const lastDigest = typeof search.last_digest_at === 'string' ? search.last_digest_at.slice(0, 10) : '';
      if (userId && lastDigest !== digestDate) users.set(userId, [...(users.get(userId) || []), search]);
    }

    let delivered = 0;
    for (const [userId, userSearches] of users) {
      const idempotencyKey = `digest:${userId}:${digestDate}`;
      const inboxRows = await insertJson(
        supabaseUrl,
        serviceRoleKey,
        'user_inbox?on_conflict=user_id,idempotency_key',
        {
          user_id: userId,
          item_type: 'digest',
          title: 'Новые совпадения VratiMe',
          body: `Проверили ${userSearches.length} сохраненных поисков за день.`,
          payload: { digest_date: digestDate, saved_search_ids: userSearches.map((search) => search.id) },
          idempotency_key: idempotencyKey,
        },
        'resolution=ignore-duplicates,return=representation',
      ) as Record<string, unknown>[];

      const inboxId = inboxRows[0]?.id || null;
      const deliveryRows = await insertJson(
        supabaseUrl,
        serviceRoleKey,
        'digest_deliveries?on_conflict=user_id,digest_date',
        { user_id: userId, digest_date: digestDate, inbox_id: inboxId, search_count: userSearches.length },
        'resolution=ignore-duplicates,return=representation',
      ) as Record<string, unknown>[];
      if (!deliveryRows.length) continue;

      const subscriptions = await selectJson(
        supabaseUrl,
        serviceRoleKey,
        `web_push_subscriptions?select=id,endpoint,p256dh,auth,enabled&user_id=eq.${userId}&enabled=eq.true`,
      ) as Record<string, unknown>[];
      const validSubscriptions = subscriptions.filter(isValidSubscription);
      for (const subscription of validSubscriptions) {
        await fetch(String(subscription.endpoint), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'VratiMe', body: 'Есть новые совпадения по сохраненному поиску.' }),
        }).catch(() => null);
      }
      if (validSubscriptions.length) {
        await patchJson(
          supabaseUrl,
          serviceRoleKey,
          `digest_deliveries?id=eq.${deliveryRows[0].id}`,
          { push_attempted: true },
        );
      }
      await patchJson(
        supabaseUrl,
        serviceRoleKey,
        `saved_searches?user_id=eq.${userId}`,
        { last_digest_at: new Date().toISOString() },
      );
      delivered += 1;
    }

    return json({ status: 'ok', digest_date: digestDate, delivered });
  } catch (error) {
    console.error('Daily digest failed', error instanceof Error ? error.message : error);
    return json({ error: 'Could not deliver daily digest' }, 503);
  }
});
