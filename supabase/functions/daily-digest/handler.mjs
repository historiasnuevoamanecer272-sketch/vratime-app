import { authorizedScheduler, smallBody } from '../notifications-dispatch/handler.mjs';
import { findDigestMatches } from './matching.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export function createDailyDigestHandler({ schedulerSecret, callRpc }) {
  return async (request) => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!authorizedScheduler(request, schedulerSecret)) return json({ error: 'unauthorized' }, 401);
    try { if (new URL(request.url).search || Object.keys(await smallBody(request)).length) return json({ error: 'invalid_request' }, 400); }
    catch { return json({ error: 'invalid_request' }, 400); }
    try {
      await callRpc('queue_handover_reminders');
      await callRpc('queue_loan_return_reminders');
      const jobs = await callRpc('claim_daily_digest_jobs', { batch_limit: 10 });
      let matched = 0, failures = 0;
      for (const job of jobs) {
        try {
          const matches = findDigestMatches(job.searches, job.candidates);
          const done = await callRpc('finish_daily_digest_job', { job_id: job.id, claim_token: job.lease_token, matches, error_code: null });
          if (!done) throw new Error('stale_lease');
          matched += matches.length;
        } catch {
          failures += 1;
          try { await callRpc('finish_daily_digest_job', { job_id: job.id, claim_token: job.lease_token, matches: null, error_code: 'processing_failed' }); }
          catch { /* Expiring leases recover even when the database is offline. */ }
        }
      }
      return json({ status: failures ? 'retry_needed' : 'ok', processed: jobs.length, matched, failures }, failures ? 503 : 200);
    } catch { return json({ error: 'digest_processing_unavailable' }, 503); }
  };
}
