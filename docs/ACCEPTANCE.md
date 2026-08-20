# VratiMe acceptance checklist

## Data and privacy

- Confirm 20 categories, 10 original listings, 8 profiles, 5 historical transactions, 8 Auth users and 3 Storage objects still exist.
- An anonymous request to `/rest/v1/profiles` must return `401` or `403` and no names or contacts.
- An authenticated user may read their own `profile_contacts` row but not another user's row.
- A listing photo upload must use `<auth.uid()>/listings/<uuid>.<ext>`; a different user's path must be rejected.

## Full two-user journey

1. Sign in with Magic Link or Google and complete a profile.
2. User A creates a listing with quantity, optional photo and map pin.
3. User B books it; a second simultaneous booking must fail.
4. Both users see the deal and the partner contact; other users do not.
5. The booking author can cancel while the history remains, or the giver completes the handover.
6. Completion awards exactly 50 eco points once, even if the request is repeated.
7. Each participant submits one 1–5 star rating; a duplicate review fails.

## Interface and release

- Repeat the flow in Russian, Montenegrin and English; reload and confirm the language persists.
- Check widths 360, 390, 768 and 1440 px; keyboard navigation; safe areas; reduced motion; location denied; offline/network errors; 5 MB photo limit.
- Run `npm run lint`, `npm run build`, `npm run test:i18n`, `npm run test:static`, `npm run db:test`, and `npm run db:e2e`.
- Preview locally before pushing. Push/deploy only after explicit approval.
