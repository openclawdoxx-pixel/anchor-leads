# Cold Email Funnel — Stress Test Report

**Date:** 2026-04-27
**Status:** Findings before launch — read before flipping campaigns to ACTIVE.

---

## TL;DR

Five real issues. One is a hard scaling block.

| # | Severity | Issue | Blocking launch? |
|---|---|---|---|
| C1 | **CRITICAL** | Mailbox capacity vs 6-step sequence — at 75 new/day steady state we need 450 sends/day; current 3 mailboxes give 120/day | Blocks scaling past ~20 new/day |
| I1 | Important | Reply race: lead replies between Email 1 and our Day-3 inbox reply — could send to a replier | Easy fix, must do before launch |
| I2 | Important | Burst pattern: our cron fires 75 inbox-replies in minutes, looks robotic to spam filters | Easy fix |
| I3 | Important | Schema gaps in `lead_funnel_state` — missing fields the threading orchestrator needs | Build during orchestrator work tomorrow |
| I4 | Important | Idempotency: double-cron-runs could double-send | Easy fix |
| P1 | Polish | Click event timing race — webhook arrives after our cron | Reconcile nightly |
| P2 | Polish | Webhook delivery reliability — Smartlead retries but not guaranteed | Reconcile nightly |

---

## C1 — Mailbox capacity is the binding constraint

### The math

Steady state at N new leads/day with the 6-email / 21-day sequence:

```
Today's send volume = N × 6 (one batch from each cohort: 0d, 3d, 7d, 14d, 18d, 21d old)
```

**At 75 new/day → 450 sends/day required.**

Current capacity: 3 mailboxes × 40 msg/day = **120/day**.

Shortfall: 330 sends/day, or **3.75× over capacity**.

### What you can sustain right now (3 mailboxes, 40/day each)

| New leads/day | Steady-state daily sends | Fits in 120/day? |
|---|---|---|
| 20 | 120 | ✅ Exactly at cap |
| 25 | 150 | ❌ 25% over |
| 50 | 300 | ❌ 2.5× over |
| 75 | 450 | ❌ 3.75× over |
| 100 | 600 | ❌ 5× over |

At 20/day with 3 mailboxes and a 6-step sequence, the 24,401-lead pool takes **~3.3 years** to work through. Not great.

### Three real paths forward

**A. Add mailboxes (recommended)**
- Target: 8–12 mailboxes total to handle 75/day comfortably
- Each mailbox ~$1/month + warmup time (2–4 weeks before live sends)
- During warmup, run at 20/day with current 3; increase as new ones come online
- Plumber-pool drains in ~10 months at full speed instead of 3 years

**B. Cut the sequence shorter for v1**
- 3 emails instead of 6 = 3 × 75 = 225/day at steady state
- Still over 120/day capacity but much closer
- Lose the sophisticated 21-day cadence, but launch faster
- Rebuild full sequence in v2 once mailboxes are added

**C. Launch at 20/day with current setup**
- Keep the full 6-step sequence
- Accept 3-year campaign timeline
- Buy time to add mailboxes in the background, ramp up as available
- This is the path of least resistance

**My push: A in parallel with C.** Launch at 20/day with what you have. Provision 5–9 more mailboxes (Zoho, Hostinger — your call which provider; Smartlead doesn't care). As they come online and finish warmup over 2–4 weeks, ramp up daily new-lead intake.

The mailbox math is the gating factor for everything else, including how aggressively we can A/B test, branch, and iterate.

---

## I1 — Reply race condition

**Scenario:** Lead replies to Email 1 at Day 2.5. Our orchestrator's nightly cron fires at midnight Day 3 to send Email 2 via `smartlead inbox reply`. Our reply lands in their inbox **after** they already responded — we look like an idiot.

**Why it happens:**
- Smartlead's `stop_lead_settings: REPLY_TO_AN_EMAIL` correctly stops their sequence steps
- But that stop applies to Smartlead's sequence — NOT to our `inbox reply` calls (which bypass the sequence entirely)
- The inbox reply API doesn't auto-check lead status before sending

**Fix:** Before each `inbox reply` call, our orchestrator queries the lead's status via `smartlead leads get-by-email` (or similar) and skips if status is `REPLIED`, `BOUNCED`, `UNSUBSCRIBED`. Add to orchestrator pre-send check.

```ts
async function shouldSendReply(leadEmail: string): Promise<boolean> {
  const lead = await smartlead.leads.getByEmail(leadEmail);
  return !["REPLIED", "BOUNCED", "UNSUBSCRIBED", "BLOCKED"].includes(lead.status);
}
```

Cost: 1 extra API call per reply (75 calls/day at full volume). Trivial.

---

## I2 — Burst pattern in our nightly inbox-reply cron

**Scenario:** At 6 AM, our orchestrator queries "leads where Email 1 was sent ~3 days ago." Returns 75 leads. We loop through, calling `inbox reply` for each. If we don't throttle, 75 emails fire in ~5 minutes.

**Why it matters:**
- Real human Kurt sends ~5–10 emails per hour on a busy day
- 75 outgoing in 5 minutes from 3 mailboxes = ~25 per mailbox per 5 min
- Spam filters detect the burst pattern → reduces inbox placement on subsequent sends from these mailboxes

**Fix:** Spread inbox replies across the working day. Cron runs hourly between 8 AM–5 PM ET (10 hours), each run handles ~10% of the day's reply queue. Rate limit at ~1 reply per mailbox per 5 min internal pacing.

**Even better:** check if Smartlead's `inbox reply` API supports a `scheduled_at` parameter — let Smartlead schedule each reply at a sane time. (Need to test; not in published docs.)

---

## I3 — `lead_funnel_state` schema gaps

Current schema (migration 011) tracks: lead_id, slug, personalized_at, personalized_blob_url, pushed_to_smartlead_at, smartlead_lead_id, status, phase, last_event_at.

The threading orchestrator needs more:

```sql
alter table lead_funnel_state
  add column if not exists email_stats_ids jsonb default '{}',  -- map: { "1": stats_id_for_email_1, "5": stats_id_for_email_5 }
  add column if not exists campaign_id     int,                 -- 3224195 (no_site) or 3238040 (has_site)
  add column if not exists email_2_reply_sent_at timestamptz,
  add column if not exists email_6_reply_sent_at timestamptz,
  add column if not exists clicked_email_steps   int[] default '{}'; -- [1, 4] = clicked Email 1 and Email 4
```

Add as migration 012 when Supabase is back. Without these, the threading orchestrator can't find the right `email_stats_id` to reply to.

---

## I4 — Idempotency

**Scenario:** Cron fires at 6 AM. Manual `vercel cron trigger` at 7 AM. Both find the same 75 leads needing Email 2 reply. Both fire the inbox reply. 75 leads get Email 2 twice.

**Fix:** Before firing each reply, check `lead_funnel_state.email_2_reply_sent_at`. If set, skip. After successful send, set it to `now()`. Same for Email 6.

The `lead_funnel_state` columns from I3 cover this.

---

## P1 — Click event timing race

**Scenario:** Lead clicks Email 1 link at 11:55 PM Day 2. Webhook fires at 11:56 PM. Our cron triggers at midnight Day 3. The webhook hasn't been processed yet (queue lag, our endpoint slow). Orchestrator sees no click → sends Path A. Should've sent Path B.

**Fix:** At reply time, don't rely solely on stored webhook events. Query Smartlead directly for the lead's click history:
```bash
smartlead stats leads --id <campaign> | filter for this lead's clicks
```
If click on Email 1 step exists, route to Path B even if our webhook record is empty.

Belt + suspenders: webhook is the fast path, direct query is the safety net.

---

## P2 — Webhook delivery reliability

**Scenario:** Smartlead's webhook delivery to our `/api/webhooks/smartlead` fails (our endpoint hiccups, Vercel cold start, network blip). They retry but eventually give up. Click event lost permanently.

**Fix:** Nightly reconciliation job. At midnight, query Smartlead for all events from the last 24h via `smartlead webhooks summary`. Diff against our event log. Replay missed events into our handler. Catches any drift.

Or: `smartlead webhooks retrigger --campaign-id X` — Smartlead's built-in retry. Use this on suspected drift.

---

## What this means for tonight + tomorrow

**Tonight (locked in):**
- Smartlead campaigns are live (paused), 4-step sequence pushed, mailboxes attached
- Don't flip ACTIVE yet. Need to address C1 first.

**Tomorrow when Supabase is back:**
- Migration 012 (the schema additions for I3 + I4)
- Build the threading orchestrator (separate spec next)
- Build pre-send status check (I1)
- Build hourly burst-spread cron (I2)
- Build webhook reconciliation (P1, P2)

**Strategic decision Kurt needs to make:**
- Which path on C1: cut sequence (B), launch at 20/day (C), or order more mailboxes (A)?
- The orchestrator code looks the same regardless — it scales to whatever mailbox count we have. The decision is operational, not engineering.
