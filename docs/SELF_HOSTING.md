# Production hosting

VratiMe is a static PWA. The application is served from the custom domain while Supabase remains the managed authentication and database backend. No database migration to the web server is required for this release.

## Current production target

- Public URL: `https://vratime.vzdigital.online/`
- Web root: `/www/wwwroot/vratime.vzdigital.online/current`
- Immutable releases: `/www/wwwroot/vratime.vzdigital.online/releases/<release-id>`
- Nginx virtual host: `/www/server/panel/vhost/nginx/vratime.vzdigital.online.conf`
- TLS certificate: Let's Encrypt for `vratime.vzdigital.online`
- Pre-deployment Nginx backup: `/data/backups/vratime-predeploy-20260919T191000Z`

GitHub Pages stays online as a fallback until the custom-domain release is fully accepted.

## Safe manual release

1. On a clean checkout, run `npm ci` and `npm test`.
2. Build with the production root base: `npm run build`.
3. Archive the *contents* of `dist` (the archive must contain `index.html` and `manifest.webmanifest` at its root).
4. Copy the archive and `scripts/server/vratime-deploy-static-v1.sh` to the server.
5. Run the script with the archive path and a unique release id, for example a commit hash plus date.
6. Verify `https://vratime.vzdigital.online/`, the service worker, and the authentication redirect flow.

The script unpacks a new immutable release and only then switches the `current` symlink, so visitors never receive a half-copied build.

## Authentication URLs

In Supabase Authentication → URL Configuration, keep local and GitHub Pages addresses and add:

- Site URL: `https://vratime.vzdigital.online/`
- Redirect URL: `https://vratime.vzdigital.online/**`

The same HTTPS origin must be registered in the Google OAuth client before enabling Google sign-in. Session storage is intentionally scoped to an origin; users sign in once on the new domain and stay signed in there until they sign out or clear browser data.

## Rollback

Nginx configuration can be restored from the backup above. Static releases are immutable: change `current` back to a previously verified release and reload Nginx. Do not delete a working release during incident response.
