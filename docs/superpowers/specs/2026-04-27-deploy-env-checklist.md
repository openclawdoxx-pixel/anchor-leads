# Anchor Funnel — Deploy Env-Var Checklist

Run the `vercel env add` commands below from `crm/` after `vercel link` is set up. Each adds the variable to **all three** environments (Production, Preview, Development) unless noted. The threading + batch crons + webhooks won't work until every required var is set.

## Required (cannot launch without)

| Var | Where to get it | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API | `https://tfhfzwwyoezpcmbyfnqm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | same place, "service_role" key | Server-only — never ship to client |
| `SUPABASE_ANON_KEY` | same place, "anon" key | OK to ship — used only if we re-enable client auth later |
| `NEXT_PUBLIC_SUPABASE_URL` | same as `SUPABASE_URL` | Next.js needs the `NEXT_PUBLIC_` prefix on the client side |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as `SUPABASE_ANON_KEY` | client-side |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Funnel agents (research/personalize/audit) |
| `SMARTLEAD_API_KEY` | Smartlead UI → Settings → API | The key you've been using in curl tonight |
| `SMARTLEAD_CAMPAIGN_ID` | Smartlead UI | Use `3224195` (no_site) as default; the orchestrator routes per-lead but a fallback is read here |
| `SMARTLEAD_WEBHOOK_SECRET` | Generate one: `openssl rand -hex 32` | Set this exact value as the webhook secret in Smartlead's webhook config too |
| `CRON_SECRET` | Generate one: `openssl rand -hex 32` | Used by Vercel's cron auth — both crons reject without `Bearer <CRON_SECRET>` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Dashboard → Storage → Blob → connect to project | Auto-injected if you use the integration; otherwise add manually |

## Recommended (graceful degradation if missing)

| Var | Default | Effect if missing |
|---|---|---|
| `LANDING_BASE_URL` | `anchor-leads.vercel.app` | Falls back to Vercel's auto-injected `VERCEL_PROJECT_PRODUCTION_URL` if not set; only set this when a custom domain is live |
| `TWILIO_ACCOUNT_SID` | — | SMS alerts disabled |
| `TWILIO_AUTH_TOKEN` | — | SMS alerts disabled |
| `TWILIO_FROM_NUMBER` | — | SMS alerts disabled |
| `TWILIO_TO_NUMBER` | — | SMS alerts disabled |

## How to add them — paste-ready

```bash
cd crm
vercel link    # one-time; pick the existing anchor-leads project

# Required:
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SUPABASE_ANON_KEY
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add ANTHROPIC_API_KEY
vercel env add SMARTLEAD_API_KEY
vercel env add SMARTLEAD_CAMPAIGN_ID
vercel env add SMARTLEAD_WEBHOOK_SECRET
vercel env add CRON_SECRET
vercel env add BLOB_READ_WRITE_TOKEN

# Optional Twilio:
vercel env add TWILIO_ACCOUNT_SID
vercel env add TWILIO_AUTH_TOKEN
vercel env add TWILIO_FROM_NUMBER
vercel env add TWILIO_TO_NUMBER
```

For each, Vercel CLI will prompt for the value + which environments to apply (pick **Production, Preview, Development** for everything except `SMARTLEAD_WEBHOOK_SECRET` and `CRON_SECRET` — those should be Production-only since preview deployments shouldn't accept real webhooks).

## Smartlead webhook configuration (manual UI step)

After deploy:

1. Smartlead UI → **Webhook Settings** (account-level, not per-campaign)
2. Add webhook with:
   - **URL**: `https://anchor-leads.vercel.app/api/webhooks/smartlead`  *(or custom domain when live)*
   - **Custom header**: `x-smartlead-secret: <SMARTLEAD_WEBHOOK_SECRET>`
   - **Events**: `EMAIL_SENT`, `EMAIL_CLICKED`, `EMAIL_REPLIED`, `EMAIL_BOUNCED`, `EMAIL_UNSUBSCRIBED`
3. Send a test event from Smartlead → confirm 200 response in Vercel logs

## Smoke-test sequence (do this BEFORE flipping campaigns to ACTIVE)

1. Apply migrations 010 + 011 + 012 in Supabase SQL Editor
2. `vercel env add` everything in the table above
3. `vercel deploy --prod`
4. `curl -X POST https://anchor-leads.vercel.app/api/cron/funnel-batch -H "Authorization: Bearer $CRON_SECRET"` — should return `{ ok: true, capacity: {...} }` with `remaining_intake > 0`
5. `curl -X POST https://anchor-leads.vercel.app/api/cron/funnel-threading -H "Authorization: Bearer $CRON_SECRET"` — should return `{ ok: true, result: { email_2_attempted: 0, ... } }` (no leads at Day 3 yet, that's correct)
6. Send a fake EMAIL_SENT webhook to `/api/webhooks/smartlead` — confirm `lead_funnel_state.email_stats_ids` populates
7. Visit `https://anchor-leads.vercel.app/l/<some-real-slug>` — confirm the landing page loads from Blob
8. **Only then**: flip both Smartlead campaigns from DRAFTED → ACTIVE
