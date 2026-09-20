# Tribute webhook

This Supabase Edge Function verifies Tribute's `trbt-signature`, converts successful EUR/RUB/USD donations to a fixed EUR snapshot, subtracts the configured Tribute fee, and inserts an idempotent contribution without storing donor names, email addresses or Telegram identifiers.

Required secrets:

- `TRIBUTE_API_KEY` — the API key generated in Tribute Creator Dashboard.
- `TRIBUTE_SUPPORTER_SALT` — a separate random secret used only to create anonymous supporter hashes.
- `SUPABASE_SERVICE_ROLE_KEY` — normally available to deployed Supabase Edge Functions.
- `TRIBUTE_FEE_PERCENT` — optional; defaults to `10`.

After deployment, set the Tribute webhook URL to:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/tribute-webhook`

Deploy this public webhook with Supabase JWT verification disabled; authenticity is checked with Tribute's HMAC signature instead:

```sh
supabase functions deploy tribute-webhook --no-verify-jwt
```

Then configure the public payment link without exposing the API key:

```sql
update public.funding_settings
set tribute_url = 'https://web.tribute.tg/YOUR_DONATION_LINK',
    enabled = true,
    updated_at = now()
where id = true;
```

The link must use either `https://web.tribute.tg/…` or `https://t.me/tribute/…`.
