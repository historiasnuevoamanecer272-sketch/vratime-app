# Ten-user verification after publication

This runner is prepared locally. It has **not** created users, invoked the live app, uploaded files or changed production records during authoring. Running without `--execute` only prints help and does not read `.env` or access the network.

The runner accepts only project `kuoflaaankpjksyssfka` at `https://kuoflaaankpjksyssfka.supabase.co` and production origin `https://vratime.vzdigital.online`. Before creating or resuming fixtures it fetches the public HTML, verifies the SHA256 of the main `/assets/index-*.js`, checks the project reference in the bounded same-origin JS import graph, and requires `RELEASE_ID` in `/RELEASE.txt`. It does not deploy anything.

The expected hash is the SHA256 of the deployed **main JS bytes**. For a known reviewed local build, compute its expected main JS hash before publication:

```powershell
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; import {createHash} from "node:crypto"; const html=fs.readFileSync("dist/index.html","utf8"); const asset=html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1]; console.log(createHash("sha256").update(fs.readFileSync(path.join("dist",asset))).digest("hex"));'
```

After publication and the root operator's release check:

```powershell
node scripts/release-ten-users-check.mjs --execute --expected-release-hash=<64_HEX_MAIN_JS_HASH> --keep-fixtures
```

The script reads public keys and the server secret from the environment or the existing local `.env`: `SUPABASE_URL`/`VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY`/`VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY`. It never prints these values, passwords, refresh tokens, access tokens or signed media URLs. Raw API messages also stay out of stdout; failures use bounded error codes and case names.

## Private fixtures and continuation

Ten admin-created, email-confirmed disposable accounts are marked by immutable admin `app_metadata.vratime_release_test`, unique UUIDs and email addresses `vratime-release-<run UUID>-01@example.invalid` through `-10`. There are two accounts for each of `ru`, `me`, `en`, `fr`, `de`. No test account is given moderator/admin privileges. Profiles use unique Telegram aliases and fictional NANP 555-01xx phone numbers; no messenger is opened.

Before any account creation, the runner writes the complete account intent and credentials into:

```text
../vratime-staged-20261019/.private-backups/release-ten-users-<run UUID>.json
```

The directory is created with mode 0700 and each ledger/temp file with mode 0600. Windows does not implement POSIX mode bits as a complete ACL system: retain the existing private staging-folder ACL, and do not copy this ledger into Git, a public report or a handoff ZIP. The ledger contains passwords and Supabase sessions for root-controlled browser screenshots. It contains no service-role key. Browser login through these sessions exercises the test account; it does not prove real Google OAuth or installed-app session retention.

Stable account IDs, listing IDs, media operation IDs and feedback request IDs are written before their requests. Acknowledged operations and checks are checkpointed. Resume the exact ledger while the same public release is deployed:

```powershell
node scripts/release-ten-users-check.mjs --execute --expected-release-hash=<SAME_HASH> --resume-ledger="C:/absolute/path/to/.private-backups/release-ten-users-<run UUID>.json" --keep-fixtures
```

Successful cases are skipped on resume. Interrupted database operations use their exact stable IDs or inspect the owned request before retry. Already completed give/loan confirmations are verified without creating new rewards. A partially failed phase can still need root review when a fixture was deliberately changed in the browser, a lease remains unresolved, or its stock/lifecycle no longer matches the phase. The runner reports that failure instead of overwriting records to make the test pass. Once cleanup has begun, use cleanup mode rather than resume mode.

## Automated coverage

- All ten accounts: three contact channels and persisted language; first avatar/save and immutable replacement; prior avatar still readable; real `media-upload` Edge decode from valid PNG to managed JPEG; owner listing photo and immediate public listing/count; blurred public pickup location; self-request denial.
- Media: same-operation retry identity; foreign listing/avatar references denied; anonymous upload denied; direct Storage upload/upsert/update denied; fake content, video MIME and >5 MiB server input rejected; six-photo listing update denied.
- Five language pairs: requested deadline is 12 hours and accepted deadline 24 hours; localized request inbox and read/foreign-write checks; exact partial stock; real simultaneous booking requests and simultaneous accept calls with one winner; cancellation and repeated-cancel refusal preserve exactly 10/0 stock.
- Give: participant contact links and exact pickup access, outsider isolation, appointment creation/reschedule/cancel, two-sided completion, repeated confirmation with no duplicate points, exactly one reuse event.
- Lend: condition photo and seven-day return term, wrong lifecycle calls denied, two-sided issue, no early completion, two-sided return, restored stock, single impact event and no duplicate reward.
- All ten accounts: private feedback attachment, concurrent `create_feedback_once` retries return the same ID, changed payload cannot reuse the ID, owner-only signed access with a 300-second expiry field, public private-bucket path denied, outsider feedback rows hidden, queued delivery receipt with zero attempts.
- Discovery: saved search, favourite, own feed and outsider isolation; collection point self-vote denial, three independent votes, public aggregate and hidden voter identities.

No `feedback-telegram` invocation occurs. The receipt check expects the queue to remain unclaimed. Root may explicitly choose **one** feedback ID from the private ledger for the separately controlled Telegram verification. Do not run an independent Telegram sender concurrently with this suite. No push subscription, digest worker or external notification delivery is fabricated or invoked.

## Exact cleanup after browser review

```powershell
node scripts/release-ten-users-check.mjs --execute --expected-release-hash=<ORIGINAL_RUN_HASH> --cleanup-ledger="C:/absolute/path/to/.private-backups/release-ten-users-<run UUID>.json"
```

Cleanup validates the original run/hash and fixed project. It deliberately does not require the current public bundle to remain unchanged, so the exact run can be removed after a later deployment or rollback. The path must remain inside the exact staging `.private-backups` directory, have the run UUID filename, and be a regular file. Existing Auth IDs must still have the expected exact email and admin marker.

The runner freezes only confirmed fixture listings before inventory, blocking new bookings. It then rebuilds exact record identities from the verified fixture owners and checks for non-fixture transactions, favourites/matches, collection-point activity, reports and moderation references. Any such interaction stops cleanup for root review. Test accounts must not be used to book, vote on or report real users' content during browser verification.

Every Storage path is inventoried under one of the confirmed fixture user IDs and added to the ledger. The cleanup plan removes exact bucket/path pairs, exact child row identities in referential order, profiles, and finally exact Auth IDs. Composite keys such as `profile_contacts(user_id,messenger_type)` and `listing_favourites(user_id,listing_id)` are preserved. Sessions are globally revoked first. Private media/notification/submission metadata linked by cascades to these exact profiles/Auth IDs are removed with their fixture parents; the private schemas are not exposed through a fake REST endpoint. There is no prefix-wide Storage deletion, `emptyBucket`, unfiltered table deletion, deletion of unrelated users, or global count comparison.

All cleanup responses are checked. A child or Storage failure stops parent deletion. Completed/error steps remain in the private ledger for cleanup-mode retry. Final checks require fixture Auth users and public fixture-root rows to be absent; credentials/tokens are erased from the successful cleanup ledger. Omit `--keep-fixtures` to run this same checked cleanup after the suite automatically. A failed test case remains a failed test even if cleanup succeeds.

REST cleanup is not one atomic PostgreSQL transaction. Listing freezing closes the booking race, but public collection-point votes and other outside interactions can still occur between a reference check and deletion. Root must review before cleanup and use a quiet verification window; do not claim this runner provides an atomic global rollback. An outside interaction triggers review when observed, rather than silently deleting another user's activity.

## Remaining manual/device checks

Passing API cases does not mean all 50 product items passed. Root must still verify the five-language UI, mobile layout/keyboard, map filters and counts in the actual app, Back/focus/scroll behavior, avatar crop/zoom and preview cleanup, browser EXIF stripping/20 MiB input normalization, draft restoration, account switching and uncertain-submit UX, real Google OAuth, Android/iOS installation and persistence, actual push permission/delivery, controlled Telegram receipt, scheduled digest delivery and retry/expiry, and the final public release/PWA update. This runner inspects deadline arithmetic without waiting 12/24 hours and checks signed-link expiry configuration without a five-minute wall-clock expiry test. Hosted Edge resource extremes, 100 MiB quota exhaustion, 30/hour limit exhaustion, and legacy privacy migration belong to the separate security/device checks. It does not promote staff, moderate real content or test money/fund operations.

Local authoring checks (offline):

```powershell
node --check scripts/release-ten-users-check.mjs
node scripts/release-ten-users-guard-check.mjs
node scripts/release-ten-users-check.mjs --help
```

The SDK account creation/deletion methods were checked against installed Supabase Auth types and the official [createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser) and [deleteUser](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) references. Application RPC names/arguments and cleanup keys come from this repository's current migrations and `src/lib/api.js`.
