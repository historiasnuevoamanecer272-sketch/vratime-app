# VratiMe Discovery and Circular Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved discovery, safe pickup, community collection-point, quantity-aware exchange, impact and cashless lending features without weakening VratiMe privacy.

**Architecture:** New data is introduced through ordered Supabase migrations and exposed only through RLS-protected RPCs. Focused API and UI modules consume those RPCs; public map discovery uses coarse coordinates while participant-only RPCs retain exact pickup details. Daily digest delivery is server-scheduled and idempotent, with in-app inbox as the guaranteed channel and opt-in web push as an additional channel.

**Tech Stack:** React 19, Vite PWA, react-leaflet, Supabase Postgres/RLS/RPC/Storage/Edge Functions, Node assertion scripts.

**Spec:** `docs/superpowers/specs/2026-09-23-discovery-and-circular-services-design.md`

## Global Constraints

- Do not add selling, prices, fees, ads, deposits, insurance promises or automatic punishment.
- Text search returns `give` listings only; `take` data is used only for a private opt-in match feed.
- Exact home coordinates, private saved-search anchors, favourites, history, digest records and appointment notes are not public.
- Daily digest is one aggregate per user per calendar day; push requires an explicit subscription.
- Collection points publish immediately as `unverified`, become `verified` after three current positive votes and return to `unverified` after two current negative votes; owners cannot vote and votes expire after 180 days.
- All new copy exists in RU, ME and EN; every animation respects `prefers-reduced-motion`.
- Preserve existing user-facing logic unless this approved specification explicitly replaces it.

## Review Focus

- A saved search around a home must never expose its anchor in a public SQL select, RPC or map payload.
- Two simultaneous acceptances must never reserve more than `available_quantity`.
- A cancellation or expiry must restore the precise reserved quantity once, and only once.
- A collection-point owner must not be able to cast a positive or negative vote on their own point, including via direct RPC calls.
- A browser that rejects notification permission must still receive its next daily digest in the in-app inbox.

---

### Task 1: Contract fixtures and pure domain helpers

**Files:**
- Create: `src/lib/quantity.js`
- Create: `src/lib/locationPrivacy.js`
- Create: `src/lib/collectionPoints.js`
- Create: `src/lib/digest.js`
- Modify: `scripts/plan-ui-logic-check.mjs`
- Create: `scripts/discovery-services-check.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `coarseCoordinates(lat, lng, gridMeters)`, `remainingQuantity(listing)`, `pointStatus(votes, now)`, `isDigestDue(search, now)`.
- `pointStatus` returns `'unverified' | 'verified'`; expired votes are ignored.

- [ ] **Step 1: Write failing assertions for privacy, votes, quantities and daily boundary.**

```js
assert.deepEqual(coarseCoordinates(42.44123, 19.26387, 300), coarseCoordinates(42.44111, 19.26372, 300));
assert.equal(remainingQuantity({ quantity: 20, available_quantity: 14 }), 14);
assert.equal(pointStatus([{ value: 'exists' }, { value: 'exists' }, { value: 'exists' }], now), 'verified');
assert.equal(isDigestDue({ last_digest_at: '2026-09-22T10:00:00Z' }, '2026-09-23T10:00:00Z'), true);
```

- [ ] **Step 2: Run the new checker and confirm it fails because the helpers do not exist.**

Run: `node scripts/discovery-services-check.mjs`  
Expected: failure importing missing helpers.

- [ ] **Step 3: Implement deterministic helpers without browser or Supabase dependencies.**

```js
export const remainingQuantity = ({ quantity, available_quantity }) => Math.max(0, Number(available_quantity ?? quantity ?? 0));
export const isDigestDue = (search, now) => !search.last_digest_at || new Date(search.last_digest_at).toDateString() !== new Date(now).toDateString();
```

- [ ] **Step 4: Register `test:discovery-services` and run it with existing UI logic tests.**

Run: `npm run test:discovery-services && npm run test:plan-ui`  
Expected: both commands pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib scripts/discovery-services-check.mjs package.json
git commit -m "test: add circular-service domain contracts"
```

### Task 2: Discovery data, private inbox and daily delivery contracts

**Files:**
- Create: `supabase/migrations/20260923010000_discovery_and_digest.sql`
- Create: `supabase/functions/daily-digest/index.ts`
- Create: `supabase/functions/daily-digest/deno.json`
- Modify: `scripts/migration-check.mjs`
- Modify: `scripts/supabase-e2e-check.mjs`

**Interfaces:**
- Produces tables `saved_searches`, `search_history`, `listing_favourites`, `listing_matches`, `user_inbox`, `digest_deliveries`, `web_push_subscriptions`.
- Produces RPCs `save_search(...)`, `toggle_listing_favourite(uuid)`, `record_search_history(text)`, `get_my_discovery_feed()`, `mark_inbox_item_read(uuid)`.
- Edge function receives a protected scheduler request and creates one `user_inbox` digest per user/date before attempting push.

- [ ] **Step 1: Add migration assertions that require RLS, owner-only policies and RPC grants.**

```js
for (const table of ['saved_searches', 'listing_favourites', 'user_inbox', 'digest_deliveries']) {
  requireText(source, `alter table public.${table} enable row level security`, `${table} RLS`);
}
requireText(source, 'create unique index if not exists digest_deliveries_one_per_day', 'one digest per person/day');
```

- [ ] **Step 2: Run `npm run test:migrations` and confirm the contract is absent.**

Run: `npm run test:migrations`  
Expected: failure mentioning the new discovery table or index.

- [ ] **Step 3: Add the migration and server function.**

```sql
create unique index if not exists digest_deliveries_one_per_day
on public.digest_deliveries (user_id, digest_date);

create policy saved_searches_owner on public.saved_searches
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
```

The Edge Function must use the service role only on the server, insert the inbox record first, send push only for valid opt-in subscriptions, and treat an existing `(user_id, digest_date)` as success.

- [ ] **Step 4: Extend E2E with two users: save a search, favourite a listing, verify no outsider read, and verify a duplicate daily delivery is rejected.**

Run: `npm run db:e2e` after applying the migration to the test database.  
Expected: private data is unreadable by the third user and exactly one digest exists.

- [ ] **Step 5: Commit.**

```bash
git add supabase scripts
git commit -m "feat: add private discovery and daily digest data"
```

### Task 3: Collection-point crowdsourcing model

**Files:**
- Create: `supabase/migrations/20260923020000_collection_points.sql`
- Modify: `scripts/migration-check.mjs`
- Modify: `scripts/supabase-e2e-check.mjs`
- Create: `src/lib/collectionPointTypes.js`

**Interfaces:**
- Produces `collection_points`, `collection_point_materials`, `collection_point_votes`, `collection_point_edits`.
- Produces RPCs `create_collection_point(...)`, `vote_collection_point(uuid, text)`, `suggest_collection_point_edit(...)`, `get_collection_points()`.
- `get_collection_points()` returns public aggregate count/status only, never voter ids.

- [ ] **Step 1: Write failing migration/E2E checks for self-vote, thresholds and vote expiry.**

```js
const selfVote = await owner.rpc('vote_collection_point', { target_point_id: pointId, vote_value: 'exists' });
if (!selfVote.error) throw new Error('Point owner was allowed to vote');
```

- [ ] **Step 2: Run the checks and confirm their failure before migration implementation.**

Run: `npm run test:migrations`  
Expected: missing collection-point security contract.

- [ ] **Step 3: Implement the tables, aggregate status function and guarded voting RPC.**

```sql
if selected_point.created_by = auth.uid() then raise exception 'Point owner cannot vote'; end if;
insert into public.collection_point_votes (point_id, user_id, value)
values (target_point_id, auth.uid(), vote_value)
on conflict (point_id, user_id) do update set value = excluded.value, created_at = now();
```

Refresh status inside the vote RPC and in an idempotent server-side expiry function. Do not require staff approval for a new point.

- [ ] **Step 4: Execute E2E: three independent positive votes, two negative votes, stale-vote expiry and outsider read of aggregate only.**

Run: `npm run db:e2e`  
Expected: status transitions are exact and individual vote identities stay private.

- [ ] **Step 5: Commit.**

```bash
git add supabase src/lib scripts
git commit -m "feat: add crowdsourced collection points"
```

### Task 4: Listing metadata and public-coordinate boundary

**Files:**
- Create: `supabase/migrations/20260923030000_listing_pickup_privacy.sql`
- Create: `src/lib/publicListings.js`
- Modify: `src/lib/api.js`
- Modify: `src/pages/MapScreen.jsx`
- Modify: `src/pages/CreateListing.jsx`
- Modify: `scripts/supabase-e2e-check.mjs`

**Interfaces:**
- Listing fields: `condition`, `pickup_mode`, `pickup_windows`, `public_lat`, `public_lng`, `public_meeting_label`, `available_quantity`, `reserved_quantity`, `weight_kg`.
- RPCs `get_public_map_listings()`, `get_transaction_pickup_details(uuid)` and enhanced `update_my_listing(...)`.
- `get_public_map_listings()` is the only public-map data source.

- [ ] **Step 1: Write failing E2E probes that compare public and participant location payloads.**

```js
if (publicListing.lat === exactLat || publicListing.lng === exactLng) throw new Error('Exact home coordinates leaked publicly');
if (participantPickup.lat !== exactLat) throw new Error('Participant could not retrieve accepted pickup details');
```

- [ ] **Step 2: Run E2E after adding the assertions and confirm failure.**

Run: `npm run db:e2e`  
Expected: current direct listing select leaks exact coordinates.

- [ ] **Step 3: Implement metadata constraints, public RPC and participant-only detail RPC.**

```sql
create function public.get_public_map_listings()
returns setof public.public_listing_map_row
security definer
set search_path = public
as $$ select ... public_lat, public_lng ... from public.listings where status = 'active' and moderation_status = 'approved'; $$;
```

MapScreen must replace its direct `listings` select with this RPC. The create/edit form must validate up to three windows, show condition and mode, and compute/submit public coordinates only through the server operation.

- [ ] **Step 4: Verify map filtering still uses the public point, and booking never uses a public coordinate as exact pickup data.**

Run: `npm run test:discovery-services && npm run db:e2e`  
Expected: all privacy and radius tests pass.

- [ ] **Step 5: Commit.**

```bash
git add supabase src scripts
git commit -m "feat: add private pickup and listing clarity"
```

### Task 5: Quantity-safe request and reservation lifecycle

**Files:**
- Create: `supabase/migrations/20260923040000_quantity_reservations.sql`
- Modify: `src/lib/api.js`
- Modify: `src/pages/MapScreen.jsx`
- Modify: `src/pages/MyDeals.jsx`
- Modify: `src/pages/Profile.jsx`
- Modify: `scripts/supabase-e2e-check.mjs`

**Interfaces:**
- `bookListing(listingId, requestedQuantity)` calls `book_listing(target_listing_id, requested_quantity)`.
- `acceptDeal(transactionId)` atomically locks listing and transaction, reserves exactly `requested_quantity`, and returns `{ transaction_id, available_quantity }`.
- Expiry/cancel/completion use `restore_or_consume_reservation(transaction_id)` exactly once.

- [ ] **Step 1: Add failing concurrent E2E acceptance scenario for 10 units requested as 7 and 6.**

```js
const results = await Promise.allSettled([acceptAsOwner(requestA), acceptAsOwner(requestB)]);
const reserved = await admin.from('listings').select('available_quantity,reserved_quantity').eq('id', listingId).single();
if (reserved.data.available_quantity < 0 || reserved.data.reserved_quantity > 10) throw new Error('Oversold listing');
```

- [ ] **Step 2: Run E2E and confirm the legacy one-open-deal index cannot meet the test.**

Run: `npm run db:e2e`  
Expected: test fails before quantity-aware migration.

- [ ] **Step 3: Replace the legacy open-listing uniqueness rule with a transaction-locking RPC and quantity constraints.**

```sql
select * into selected_listing from public.listings where id = selected_transaction.listing_id for update;
if selected_listing.available_quantity < selected_transaction.requested_quantity then raise exception 'Not enough quantity available'; end if;
update public.listings set available_quantity = available_quantity - selected_transaction.requested_quantity,
  reserved_quantity = reserved_quantity + selected_transaction.requested_quantity where id = selected_listing.id;
```

- [ ] **Step 4: Add UI request amount selector and remaining/reserved wording to map, deal and profile cards. Test cancellation and expiry restoration twice.**

Run: `npm run db:e2e && npm run build`  
Expected: no oversell and no double restoration.

- [ ] **Step 5: Commit.**

```bash
git add supabase src scripts
git commit -m "feat: support partial quantity exchanges"
```

### Task 6: Appointments, reminders and reliability view

**Files:**
- Create: `supabase/migrations/20260923050000_appointments_reliability.sql`
- Modify: `supabase/functions/daily-digest/index.ts`
- Create: `src/components/AppointmentCard.jsx`
- Modify: `src/lib/api.js`
- Modify: `src/pages/MyDeals.jsx`
- Modify: `src/pages/Profile.jsx`
- Modify: `scripts/supabase-e2e-check.mjs`

**Interfaces:**
- `handover_appointments` stores transaction, scheduled time, state, reschedule proposal and reminder sent timestamps.
- RPCs `schedule_handover(...)`, `set_handover_outcome(uuid, text)` and `get_my_reliability()`.
- Reliability result is `{ completed_count, accepted_cancellations, confirmed_no_shows_90d }`.

- [ ] **Step 1: Add failing tests for participant-only scheduling and neutral one-sided no-show.**

```js
const outsiderSchedule = await clientC.rpc('schedule_handover', { target_transaction_id: dealId, scheduled_for: futureTime });
if (!outsiderSchedule.error) throw new Error('Outsider scheduled another deal');
```

- [ ] **Step 2: Run E2E and verify missing appointment contracts.**

Run: `npm run db:e2e`  
Expected: missing RPC/table error.

- [ ] **Step 3: Implement participant RPCs and idempotent reminder selection.**

```sql
update public.handover_appointments
set reminder_3h_sent_at = now()
where scheduled_for between now() + interval '2 hours 55 minutes' and now() + interval '3 hours 5 minutes'
  and reminder_3h_sent_at is null;
```

Never update ratings in this code path. Surface reminders in `user_inbox` before attempting opt-in push.

- [ ] **Step 4: Add mobile-safe appointment cards and profile reliability card; test reschedule and double outcome submissions.**

Run: `npm run db:e2e && npm run build`  
Expected: only participants see details and reliability has no automatic penalty.

- [ ] **Step 5: Commit.**

```bash
git add supabase src scripts
git commit -m "feat: add handover appointments and reliability"
```

### Task 7: Lending state machine and reusable impact events

**Files:**
- Create: `supabase/migrations/20260923060000_lending_and_impact.sql`
- Create: `src/lib/lending.js`
- Modify: `src/lib/api.js`
- Modify: `src/pages/CreateListing.jsx`
- Modify: `src/pages/MyDeals.jsx`
- Modify: `src/pages/Profile.jsx`
- Modify: `scripts/supabase-e2e-check.mjs`

**Interfaces:**
- Listing intent includes `lend`; loan transaction fields include `return_due_at`, `handed_over_at`, `returned_at`.
- RPCs `confirm_loan_handover(uuid)`, `confirm_loan_return(uuid)`.
- `reuse_events` has unique transaction id, event kind, item count, optional weight and category snapshot.

- [ ] **Step 1: Write failing state-machine assertions for lend handover/return and unique impact event.**

```js
if (!(await borrower.rpc('confirm_loan_return', { target_transaction_id: loanId })).error) {
  throw new Error('Loan returned before handover');
}
```

- [ ] **Step 2: Run E2E and confirm lending RPCs do not exist.**

Run: `npm run db:e2e`  
Expected: missing lend state transition.

- [ ] **Step 3: Add explicit loan states, return deadline and immutable reuse-event trigger/RPC.**

```sql
if selected_transaction.handed_over_at is null then raise exception 'Loan has not been handed over'; end if;
insert into public.reuse_events (transaction_id, event_kind, item_count, weight_kg)
values (...) on conflict (transaction_id) do nothing;
```

- [ ] **Step 4: Add a separate lend selection in create flow and return card in deals; show item/category/declared-weight totals in profile.**

Run: `npm run db:e2e && npm run build`  
Expected: lending cannot follow giveaway completion paths; CO2 is absent.

- [ ] **Step 5: Commit.**

```bash
git add supabase src scripts
git commit -m "feat: add lending and reuse impact"
```

### Task 8: Discovery, collection-point and accessibility interface

**Files:**
- Create: `src/components/DiscoveryInbox.jsx`
- Create: `src/components/CollectionPointDialog.jsx`
- Create: `src/components/CollectionPointLayer.jsx`
- Modify: `src/pages/MapScreen.jsx`
- Modify: `src/pages/Profile.jsx`
- Modify: `src/lib/mapMarkers.js`
- Modify: `src/components/Icon.jsx`
- Modify: `src/index.css`
- Modify: `src/i18n/index.js`

**Interfaces:**
- `DiscoveryInbox({ userId })` consumes `getMyDiscoveryFeed()`.
- `CollectionPointLayer({ points, onVote, onSelect })` renders only public aggregate values.
- Map tab switches `Listings | Collection points`; the default remains Listings.

- [ ] **Step 1: Add i18n topology test expectations for every new key in RU/ME/EN.**

```js
for (const key of ['discovery.savedSearches', 'points.unverified', 'lending.returnDue']) assertI18nKey(key);
```

- [ ] **Step 2: Run `npm run test:i18n` and confirm it fails until all locales contain the keys.**

Run: `npm run test:i18n`  
Expected: missing translations.

- [ ] **Step 3: Implement components with labels, textual statuses and reduced-motion-safe visual feedback.**

```jsx
<button type="button" aria-pressed={isFavourite} onClick={() => onToggleFavourite(listing.id)}>
  <Icon name="heart" filled={isFavourite} /><span>{t('discovery.favourite')}</span>
</button>
```

Never make colour the only indication of a verified point, condition, reliability or loan state.

- [ ] **Step 4: Verify at 390px and desktop: map filter, point voting, saved search, partial request, appointment and lending cards remain reachable above the fixed navigation.**

Run: `npm run test:i18n && npm run build`  
Expected: translated build succeeds and manual visual checklist has no clipped primary control.

- [ ] **Step 5: Commit.**

```bash
git add src scripts
git commit -m "feat: surface discovery and collection services"
```

### Task 9: Full security, E2E, production and documentation release

**Files:**
- Modify: `scripts/supabase-e2e-check.mjs`
- Modify: `scripts/migration-check.mjs`
- Modify: `docs/PROJECT.md`
- Modify: `docs/CURRENT_STATE.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/DECISIONS.md`
- Create: `docs/handoffs/HANDOFF_2026-09-23.md`
- Create: `docs/operations/RELEASE_REPORT_2026-09-23.md`

**Interfaces:**
- E2E must create isolated users, apply every new workflow, clean all created rows/storage and compare before/after counts.
- Production acceptance includes scheduled-function secrets, daily delivery verification, mobile/desktop visual verification and immutable archive checksum.

- [ ] **Step 1: Add a requirement-to-test matrix to the release report before claiming completion.**

```md
| Requirement | Authoritative evidence |
| --- | --- |
| Exact home location private | `db:e2e` public/participant probe |
| Daily digest once | unique delivery row and Edge Function run |
```

- [ ] **Step 2: Run all local and live checks.**

Run: `npm test && npm run db:public && npm run db:e2e && npm run test:production`  
Expected: all commands pass after migration/deploy; E2E returns to initial row counts.

- [ ] **Step 3: Manually verify desktop and 390px mobile scenarios with two accounts.**

Verify: save-search digest, favourite privacy, coarse home marker, three-vote point, partial reservation, appointment/no-show, lend/return and impact total.

- [ ] **Step 4: Update canonical documentation with exact deployed commit/release id and create archive excluding secrets, `.env`, backups and `node_modules`.**

Run: `git archive --format=zip --output=deliverables/vratime-2026-09-23-circular-services.zip HEAD`  
Expected: archive contains source, migrations, docs, handoff and report; SHA-256 is recorded beside it.

- [ ] **Step 5: Commit the documentation, then deploy only after all evidence is green.**

```bash
git add docs scripts
git commit -m "docs: record circular services release"
```
