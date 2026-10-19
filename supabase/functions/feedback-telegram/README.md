# Feedback → Telegram (local candidate)

This directory prepares the existing “Есть идеи для VratiMe” feedback flow for server-side Telegram delivery. Nothing here has been deployed, configured on a server, or sent to Telegram. The existing `create_feedback` RPC remains the source of the saved feedback ID. No dependency is added.

## Frontend contract

After the existing save returns a UUID:

```js
const feedbackId = await createFeedback({ type, message, screenshotUrl });
const { data, error } = await supabase.functions.invoke('feedback-telegram', {
  body: { feedbackId },
});
```

The caller's Supabase session supplies the bearer token. The request accepts only a string UUID in `feedbackId`; recipients, URLs, user IDs, and message text cannot be supplied to this endpoint.

| HTTP | JSON | Meaning |
| --- | --- | --- |
| 200 | `{ feedbackId, delivery: "delivered" }` | Telegram returned a message ID and the receipt was saved. |
| 200 | `{ feedbackId, delivery: "delivered", duplicate: true }` | An earlier confirmed delivery was already saved; no second message was sent. |
| 202 | `{ feedbackId, delivery: "unconfigured" }` | Feedback exists; bot settings are absent or invalid. |
| 202 | `{ feedbackId, delivery: "queued", retryAfterSeconds?: 60 }` | Feedback exists; another send holds its lease, a known rejection is waiting for retry, or the attempt limit requires operator review. |
| 202 | `{ feedbackId, delivery: "ambiguous" }` | Acceptance by Telegram could not be established or its receipt could not be saved. Automatic resend is suppressed. |
| 400 / 401 / 404 / 405 / 413 / 415 | `{ error: "…" }` | Invalid request, invalid session, missing/foreign feedback, method, size, or content type. |
| 503 | `{ error: "temporarily_unavailable" }` | Auth/database/server settings unavailable. |

The save and forwarding are separate steps. Once `create_feedback` succeeds, an invocation error must still show that the feedback was saved; do not report that the feedback save failed or submit a second `create_feedback`. Only `delivery === 'delivered'` justifies a Telegram success message. Suggested UI strings for translation: “Отзыв сохранён и отправлен в Telegram”, “Отзыв сохранён. Отправка в Telegram пока не подтверждена”, “Отзыв сохранён. Telegram ещё не настроен”.

## Server-only settings, later

- `TELEGRAM_BOT_TOKEN`: the Bot API token of the intended bot, entered only as a server secret.
- `TELEGRAM_CHAT_ID`: the numeric private chat ID belonging to the intended account. `https://t.me/vszaharov` / `@vszaharov` is not a private Bot API chat ID and is rejected as a setting. The intended account needs to start the bot before the bot can message it.
- Supabase Edge runtime settings `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are read only on the server. They are never returned or placed in frontend environment variables.

Do not create credentials or set these values from the browser. The candidate requires the local migration `20261019062051_feedback_telegram_delivery_queue.sql`, the Edge Function deployment, verified bot settings, and a separately authorized real delivery test before it can be described as live. This preparation does not apply the migration or deploy anything. Follow the current Supabase CLI help when the user later authorizes those steps.

## Authentication, queue, and delivery semantics

The handler calls the actual Supabase Auth `GET /auth/v1/user` API, equivalent to `auth.getUser(token)`, before it uses the returned user ID. It does not decode/trust client JWT claims or user metadata. A server-only, `SECURITY INVOKER` claim RPC checks ownership of the existing feedback. Queue access and RPC execution are revoked from PUBLIC, anon, and authenticated; only `service_role` has the necessary grants. Queue RLS is enabled. The existing save transaction queues new feedback via a local trigger with no HTTP call. Older feedback is queued lazily only after its owner asks for delivery.

One row per feedback and a transaction/advisory lock deduplicate claims. A confirmed delivery is terminal. Each feedback has at most five send attempts; the sender limits each user to five distinct attempted feedback items per minute, with a minimum 60-second backoff for rejected requests. An active sending lease lasts one minute. The handler's Telegram timeout is ten seconds. Only a confirmed Telegram `{ ok: false, error_code }` rejection becomes retryable; a transport failure or malformed acknowledgement is ambiguous.

There is **no scheduled queue worker** in this narrow transport addition. The frontend invocation makes an immediate attempt. Failed/unconfigured/limited rows remain stored for later owner invocation or separately prepared server retry operations after setup. A background retry schedule is additional server configuration, not a promise made by this candidate.

Telegram `sendMessage` does not provide an application idempotency key. Exactly-once delivery cannot be guaranteed across a timeout, process termination, or receipt database failure. The lease is not blindly recycled: an expired in-flight send becomes `ambiguous`. An operator must reconcile that row against the destination chat before any resend. This favors suppressing duplicate messages; it can leave a feedback item awaiting review without a Telegram copy.

Messages use plain text without `parse_mode`, include the feedback ID for reconciliation, and stay within 4096 UTF-16 code units. An optional screenshot is included only as a link to this project's public `LISTING-PHOTOS/<verified-owner>/feedback/<UUID>.<image-extension>` path, without query parameters. No screenshot or user-provided URL is fetched. Link previews are disabled. Exceptions and Telegram descriptions are not logged or returned because fetch errors can contain the bot token in the URL. The handler never changes or deletes the original feedback.

## Focused offline verification

```powershell
node scripts/feedback-telegram-check.mjs
```

This imports the real handler and replaces only its HTTP boundary with fixtures for Auth, service-role RPC calls, and Telegram. It makes no real Auth, production database, storage, or Telegram call. It is not a real Telegram delivery test.

The same script can additionally apply the actual candidate migration to an in-memory PGlite PostgreSQL database when that tool is already installed outside the application:

```powershell
node scripts/feedback-telegram-check.mjs --pg-tools='C:/absolute/path/to/node_modules/@electric-sql/pglite'
```

No package is installed by the script. The SQL fixture checks queue creation, RLS/grants, invoker permissions, ownership, active leases, receipt tokens, deduplication, retry backoff, attempt limits, per-user limits, expired ambiguous claims, and retained feedback. It does not claim equivalence to a deployed Supabase Edge runtime or a real Telegram chat.

References checked during preparation: [Supabase Auth integration](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage), [Telegram bot FAQ](https://core.telegram.org/bots/faq#how-do-i-send-messages-to-users).
