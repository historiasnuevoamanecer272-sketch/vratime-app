# VratiMe

Mobile-first C2C exchange for reusable packaging, clothes and materials in Montenegro. The interface supports Russian, Montenegrin and English, Magic Link authentication, optional Google OAuth, a map-based catalogue, transactional booking, private partner contacts, ratings and eco points.

## Local development

1. Copy `.env.example` to `.env` and fill in the public Supabase URL and publishable/anon key.
2. Run `npm ci`.
3. Run `npm run dev` and open `http://127.0.0.1:5173/`.

Quality checks:

```bash
npm run lint
npm run build
npm audit
```

## Supabase

The schema is versioned in `supabase/migrations`. The current migration protects contact details, tightens RLS and Storage policies, translates categories, and adds server-side RPC for booking, cancellation, completion and reviews.

Database helper commands require `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`, and optionally `SUPABASE_DB_PORT`:

```bash
npm run db:check
npm run db:test
npm run db:migrate
```

`db:test` performs a two-user end-to-end transaction and rolls every test write back.

## Release

GitHub Actions reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from repository secrets. It deploys GitHub Pages only from `main`; the revival branch is meant for local acceptance first.

- OAuth setup: `docs/GOOGLE_OAUTH_SETUP.md`
- Acceptance checklist: `docs/ACCEPTANCE.md`
- Future server deployment: `docs/SELF_HOSTING.md`
