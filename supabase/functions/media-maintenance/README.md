# Media maintenance and storage budget monitor

Locally prepared for approved item 35. No live migration, maintenance deletion, scheduler installation, secret update or Telegram call was performed by this implementation task.

## Server-only endpoint

`POST /functions/v1/media-maintenance` requires an exact `X-Media-Maintenance-Secret` match against `MEDIA_MAINTENANCE_SECRET` (32–256 characters). User JWTs, service API keys, arbitrary authorization strings and secret substrings do not authorize this endpoint. The only accepted JSON field is `mode`: `{}` or `{"mode":"dry-run"}` is a dry-run; `{"mode":"run"}` requires `MEDIA_MAINTENANCE_EXECUTION_ENABLED=true`. Request bodies are limited to 256 bytes/two seconds. There are no caller-provided recipients, URLs, budget values, paths or cleanup ages.

The release owner must add the function to `supabase/config.toml` with `verify_jwt=false`: this is a scheduler endpoint using its separate exact secret rather than a user JWT. This task deliberately leaves the already reviewed configuration and upload pipeline unchanged. Deployment and scheduler configuration belong to the release owner.

Environment:

| Variable | Meaning |
| --- | --- |
| `MEDIA_MAINTENANCE_SECRET` | Dedicated scheduler secret, required for dry-run and execution. |
| `MEDIA_MAINTENANCE_EXECUTION_ENABLED` | Missing/false by default; set to exactly `true` only after reviewing a dry-run. Enables bounded managed cleanup and owner alert delivery. |
| `MEDIA_STORAGE_BUDGET_BYTES` | Explicit media storage budget in bytes, 1–10^15. No plan size or monetary quota is guessed. Missing budget reports `budget_not_configured` and sends no threshold alert. |
| `MEDIA_MAINTENANCE_MAX_CLEANUP` | Default 2 managed assets per run, maximum 5; the time budget can stop earlier. |
| `VRATIME_TELEGRAM_BOT_TOKEN`, `VRATIME_TELEGRAM_CHAT_ID` | Preferred existing owner bot and recipient configuration. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Fallback only when the corresponding preferred variable is absent/empty. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server environment only. HTTPS origin required except local Supabase `localhost`, `127.0.0.1`, `kong`, `supabase_kong` HTTP origins for runtime testing. |

Do not put scheduler/service/bot secrets into browser code, query strings or logs. The handler never prints network exceptions, since Telegram request URLs contain the bot token. Only fixed Telegram API and trusted server-environment Supabase origins are used.

## Cleanup

Dry-run calls the existing read-only candidate RPC and reports a bounded preview. It does not claim/delete assets, queue alerts or send messages. Execution considers at most the configured batch of **managed ledger assets**, aged at least seven days. Every deletion obtains a fresh existing `media_claim_cleanup` result; the stale report path is never used for deletion. Existing SQL claim/row-lock/reference checks mark the asset `deleting`, block new attachments, and enforce claim tokens. Storage API deletion is followed by `media_finish_cleanup`, which confirms metadata absence before recording `deleted`.

Legacy objects with no managed asset ID are always skipped, including old public feedback files. They are never deleted by this endpoint. Referenced files, fresh files, active uploads and active cleanup leases remain protected by the existing reviewed SQL. Uncertain Storage responses are reconciled through the existing lease/missing-object path on a later run. There is no direct deletion of Storage metadata.

The handler has a 45-second request budget, four-second outbound request timeouts, a conservative cleanup start cutoff and one alert send per run. It does not schedule itself. The release owner should review dry-run output before enabling execution and installing a periodic scheduler with the exact secret header.

## Authoritative usage and warning receipts

`media_storage_usage()` sums authoritative `storage.objects.metadata.size` for `AVATARS`, `LISTING-PHOTOS`, and `FEEDBACK-ATTACHMENTS`. It counts all owners and pre-existing objects in these buckets, including unmanaged files. It excludes reservations, other buckets and database/index bytes. Missing/malformed sizes are explicitly counted as unknown; `knownBytes` is then a lower bound, and `usageComplete=false`. This is a configured media budget monitor, not a claim about complete account billing across other buckets/projects.

`media_observe_storage(budget)` serializes the monitor state and records a warning when usage crosses into 80% or 95%. Stable usage does not create repeat warnings. A verified decrease re-arms a later crossing; changing the budget supersedes obsolete queued warnings. Unknown sizes cannot falsely declare a decrease. When a jump crosses directly to 95%, one 95% warning is queued. Messages contain the event's measured byte snapshot and configured budget.

`media_claim_storage_alert` leases one queued event. A confirmed Telegram result must include `ok=true`, a positive message ID and the configured recipient chat ID before `media_finish_storage_alert` may record `delivered`. The reply exposes that receipt; repeated runs reuse it without resending. Explicit Telegram failures retry after at least 60 seconds, at most three attempts. Missing bot configuration consumes no attempt. Network timeouts, malformed/unknown acknowledgements and expired sending leases become `ambiguous` and require operator reconciliation; they are never blindly retried. If Telegram acknowledged a send but the database receipt could not be saved, the response is `receipt_pending` with `telegramAcknowledged=true`, and the lease prevents an immediate resend.

The new RPCs and private monitor/receipt tables are service-role only with RLS enabled. No owner identities, recipients or credentials are accepted from the request or stored in the alert ledger. A failed/ambiguous receipt is reported truthfully rather than called delivered.

## Traffic gap

Every report explicitly returns `traffic.status="unavailable"`: reliable egress/request telemetry is not connected here. Object bytes cannot measure downloads, cache hits or network traffic. [Supabase's bandwidth documentation](https://supabase.com/docs/guides/storage/serving/bandwidth) uses request/log telemetry for egress; connecting an authorized Logs Explorer/usage metric source remains a separate monitoring requirement. This implementation does not estimate or claim a traffic threshold warning.

## Verification

`node scripts/media-maintenance-check.mjs` executes the exact new migration and the existing reviewed cleanup migration in focused PGlite fixtures, then drives the real handler through injected HTTP/Telegram boundaries. TDD RED evidence and GREEN results are in the external staging `media-maintenance-*.log` / `media-maintenance-green.json` files. Tests include usage scope, unknown sizes, threshold transitions, budget changes, tied timestamps, permissions, retry limits, stale leases, exact scheduler authorization, default dry-run, bounded managed-only deletion, preferred/fallback bot configuration, recipient confirmation, duplicate suppression and lost receipt handling. All deletions and Telegram responses in those tests are offline fixtures.

The parent release task owns actual Edge runtime/deployment validation, environment setup and scheduling. No full npm suite was run here, as explicitly requested for this isolated task; only scoped tests and migration/syntax verification are used.
