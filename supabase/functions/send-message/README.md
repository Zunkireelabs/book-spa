# send-message Edge Function

This Edge Function processes outreach messages from the `outreach_messages` table, resolves the appropriate provider (email, SMS, WhatsApp), and sends the message via that provider's API. It is called by a Postgres trigger (via `net.http_post`) when a message's status is set to `'sending'`.

## Required Secrets

Deploy the following environment variables to **both** the staging and production Supabase projects:

- `CRON_BEARER_TOKEN` — Bearer token for authenticating outreach drain calls (same token used by the cron scan)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (never expose to the browser)
- `RESEND_API_KEY` — Resend email API key
- `RESEND_FROM_ADDRESS` — Default "from" email address for Resend

## Deployment

Deploy to **both** staging and production separately via:

```bash
supabase functions deploy send-message --project-id <project-id>
```

This function is **not** built by the main Vite CI/CD pipeline; it is deployed as a Deno Edge Function directly to Supabase.
