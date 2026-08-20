# Later self-hosting

Build once with `npm ci && npm run build` and serve the resulting `dist` directory as a static SPA through Nginx or Caddy. Configure every unknown path to fall back to `index.html`.

Before switching traffic:

1. Attach the final domain and enable TLS/HTTPS.
2. Add `https://your-domain.example/**` to Supabase Authentication Redirect URLs and make it the Site URL.
3. Add the same origin to the Google OAuth client.
4. Build with the same three `VITE_*` values used by GitHub Pages.

The application and database do not need to be rewritten for this move.
