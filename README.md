# VratiMe

Mobile-first C2C exchange for reusable packaging, clothes and materials in Montenegro. The interface supports Russian, Montenegrin and English, Magic Link authentication, optional Google OAuth, a map-based catalogue, multiple listing photos, transactional booking, private partner contacts, ratings, eco points and a ten-level achievement system.

## Project documentation

The canonical documentation index is [`docs/README.md`](docs/README.md). Product intent, current production state, decisions, roadmap, release history, visual rules and operational instructions live there. Dated handoff files are archival snapshots and must not override the canonical documents.

## Local development

1. Copy `.env.example` to `.env` and fill in the public Supabase URL and publishable/anon key.
2. Run `npm ci`.
3. Run `npm run dev` and open `http://127.0.0.1:5173/`.

Quality checks:

```bash
npm test
npm audit
```

## Supabase

The schema is versioned in `supabase/migrations`. The current migration protects contact details, tightens RLS and Storage policies, translates categories, and adds server-side RPC for booking, cancellation, completion and reviews.

Database helper commands require `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`, and optionally `SUPABASE_DB_PORT`:

```bash
npm run db:check
npm run db:public
npm run db:test
npm run db:e2e
npm run db:migrate
```

`db:public` performs a read-only live check with the public anon key: category translations, active listings and blocked anonymous access to private tables. `db:test` runs a database transaction and rolls every test write back. `db:e2e` creates five isolated temporary Auth users, exercises the live HTTP/Auth/Storage/RPC flow including a concurrent booking race and both listing roles, then removes only those generated records and verifies the original row counts. It reads the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`; add only `SUPABASE_SECRET_KEY` locally before running it. Never commit that secret.

## Release

GitHub Actions reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from repository secrets. It deploys GitHub Pages only from `main`; the revival branch is meant for local acceptance first.

- OAuth setup: `docs/operations/GOOGLE_OAUTH_SETUP.md`
- Acceptance checklist: `docs/operations/ACCEPTANCE.md`
- Server deployment: `docs/operations/SELF_HOSTING.md`
