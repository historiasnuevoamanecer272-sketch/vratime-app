export function createRpcClient(url, serviceKey, fetcher = fetch) {
  return async (name, body = {}) => {
    if (!url || !serviceKey || !/^[a-z_]+$/.test(name)) throw new Error('notification_database_not_configured');
    const response = await fetcher(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('notification_database_unavailable');
    return response.json();
  };
}
