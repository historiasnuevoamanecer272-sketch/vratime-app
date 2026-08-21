# Google OAuth for VratiMe

Google sign-in needs one configuration step in Google Cloud and one in Supabase. No application code change is required afterwards.

## 1. Supabase callback

In Google Cloud Console create an OAuth 2.0 Web client. Add this exact **Authorized redirect URI**:

`https://kuoflaaankpjksyssfka.supabase.co/auth/v1/callback`

Add the production domain to **Authorized JavaScript origins**:

`https://historiasnuevoamanecer272-sketch.github.io`

## 2. Supabase provider

In Supabase open Authentication → Providers → Google, enable it, and paste the Google Client ID and Client Secret.

In Authentication → URL Configuration use the deployed application as Site URL:

`https://historiasnuevoamanecer272-sketch.github.io/vratime-app/`

Add these Redirect URLs:

- `http://localhost:5173/**`
- `http://127.0.0.1:5173/**`
- `https://historiasnuevoamanecer272-sketch.github.io/vratime-app/**`

## 3. GitHub setting

In GitHub Settings → Secrets and variables → Actions → Variables set:

`VITE_GOOGLE_AUTH_ENABLED=true`

Keep it `false` until the Google provider is configured; the button then explains that OAuth is not ready instead of leading to an error.

References: [Supabase Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
