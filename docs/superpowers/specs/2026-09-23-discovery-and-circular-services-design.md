# VratiMe — discovery, circular services and trusted exchange

**Status:** approved product design, awaiting implementation plan.

## Goal

Extend VratiMe as a free local reuse service without introducing selling, fees, advertisements, deposits or automatic punishments. Build the approved set: daily saved-search digest, favourites, pickup scheduling, item condition, approximate home markers, quantity-aware exchange, reliability signals, handover reminders, transparent impact, user-maintained collection points and a pilot lending flow.

Existing live deals are test data and do not constrain data-model changes.

## Product boundaries

- Text search still means discovery among `give` listings; `take` listings are used for opt-in matching, not the direct text results.
- Contacts remain private and become available to the two transaction participants as already agreed.
- A precise home location never appears on the public map. A public-place handover may be exact.
- Daily digest frequency is once per day by default. Push is opt-in; in-app digest remains available without browser permission.
- A report or an unconfirmed no-show never changes rating automatically.
- Lending is separate from giving and remains cashless in the initial release.

## Release 1 — discovery, listing clarity and collection points

### Saved searches, history, favourites and matches

Create `saved_searches` with owner, normalized query, selected categories, radius, private map anchor, enabled flag, last_seen_at and last_digest_at. Keep a capped local/server search-history list. Create `listing_favourites` as an owner-private junction table.

Daily digest finds only approved, active `give` listings created or made available after `last_digest_at`, within the stored radius and matching query/category. It deduplicates listing ids per search and records delivery. The first delivery surface is the in-app Notifications/Matches page; browser push is added only after an opt-in subscription is registered. One person receives at most one digest per calendar day; its content aggregates all saved searches.

Create a private `listing_matches` feed that links an active `take` listing or saved search to an approved `give` listing. It never reveals another participant's contact details and does not create a transaction.

### Listing clarity and privacy

Add condition (`excellent`, `good`, `flawed`, `repair`, `parts`), pickup mode (`meet`, `safe_drop`, `public_point`), up to three pickup windows and an optional public-meeting label. Add public coordinates calculated from a deterministic coarse grid for private/home points; exact coordinates stay in the protected listing record. Map discovery uses an RPC/view that returns only public coordinates. The protected exact point is returned to transaction participants by a dedicated RPC after acceptance.

### Community collection points

Create `collection_points`, `collection_point_materials`, `collection_point_votes` and `collection_point_edits`.

- Any authenticated user can add a point, which is immediately visible as `unverified`.
- A user cannot vote on their own point and can cast one current vote per point.
- Three independent current `exists` votes make a point `verified`.
- Two independent current `missing` votes return it to `unverified`; audit history remains.
- Votes expire after 180 days. A scheduled refresh recalculates status and records the last confirmation date.
- Points have type, materials, optional schedule, source link, photo and edit suggestions. They are a separate map layer and do not use listing reservation or moderation.

## Release 2 — quantity-aware exchange and appointment flow

### Quantity model

Keep `listings.quantity` as original total, add `available_quantity` and `reserved_quantity`, and add `requested_quantity` to transactions. Replace the one-open-transaction-per-listing rule with a quantity-safe transactional acceptance operation.

Requests may coexist while unaccepted. On acceptance, the RPC locks the listing, confirms sufficient available quantity, decrements available quantity, increments reserved quantity and cancels only overlapping requests when no stock remains. A listing remains discoverable while `available_quantity > 0`. Cancellation or expiration restores its reserved quantity. Completion permanently consumes the reserved quantity. The UI labels each stage with original, available and requested values.

### Appointment and no-show workflow

Create `handover_appointments` linked to accepted transactions. The owner or both sides select one permitted pickup window and a time. Reminders are queued for three hours and thirty minutes before the appointment; they appear in-app and become push only for opt-in recipients.

After the appointment, either participant can mark `completed`, propose `reschedule`, or report `did_not_happen`. A no-show is a neutral pending event, shown to the other party and available for a report; it affects reliability only when both participants agree or staff upholds a related report.

### Reliability

Expose a derived profile card: completed exchanges, accepted cancellations and confirmed no-shows in the last 90 days. Do not expose a hidden score, do not downgrade a rating automatically and do not calculate response time because conversation occurs through participant-selected external channels.

## Release 3 — lending and transparent impact

### Lending pilot

Introduce `lend` as a separate listing intent. Lend listings require a planned return date and condition-at-handover photo checklist. Their transaction states are request, accepted, handed-over, return-due, returned, canceled. Both sides confirm initial handover and return. The lender receives reminders before return due date. No payment, deposit, insurance promise or automated penalty is implemented.

### Impact

Create immutable `reuse_events` after a completed give or returned loan. Store item count, categories and optional declared kilograms; display personal and community totals. Do not calculate CO2 until a documented category methodology is approved.

## Data access and operations

- RLS makes saved searches, history, favourites, private anchors, exact coordinates, digest records and appointment notes owner/participant-private.
- Community points and their public confirmation aggregate are readable by everyone; individual voter identities are not publicly exposed.
- All critical mutations use `SECURITY DEFINER` RPCs with locked rows, ownership/participant checks and explicit grants.
- Scheduled jobs run only server-side and must be idempotent.
- New models, map layers and states receive RU/ME/EN translations, reduced-motion-safe UI and mobile verification.

## Acceptance checks

1. A saved search produces only one daily deduplicated digest and has no public location leak.
2. Favourites and history cannot be read by another user.
3. The public map cannot return exact home coordinates; accepted transaction participants can access the necessary pickup location.
4. Concurrent quantity acceptance never reserves more than available stock and correctly restores it on cancellation/expiry.
5. Community point status changes only at the 3-positive / 2-negative thresholds, without self-voting, and stale votes expire.
6. Appointment reminders and no-show states do not automatically affect reputation.
7. A loan cannot be completed as a giveaway and requires a return confirmation.
8. Impact totals are traceable to immutable completed events and do not claim unsupported CO2 values.
