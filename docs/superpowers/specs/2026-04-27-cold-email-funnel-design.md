# Cold Email Funnel — Design Spec

**Date:** 2026-04-27
**Project:** anchor-leads (acquisition channel)
**Status:** approved, plan to be written next

---

## 1. Purpose

Ship Kurt's acquisition channel: a Vercel-hosted, fully automated daily cold-email pipeline that sends 75 (scaling to 1000+) personalized landing-page links to the 24,401 MX-verified plumber leads in Supabase. Each lead receives Kurt's pre-written email body with a unique URL pointing at a per-lead landing page that quotes their actual Google reviews, references their specific business, and feels hand-crafted.

The personalization is on the **landing page**, not the email body. Email bodies are static templates with one merge field (`{{landing_url}}`). Smartlead handles the send pipeline; this system handles the prep pipeline.

## 2. Non-goals

- No new scraping. The April 2026 scrape (24k MX-verified emails, 2,854 owner names, review samples for ~10k leads) is the data pool.
- No LLM-generated email body copy. Kurt's templates are written and final.
- No reply automation. Replies route to Kurt's inbox via Smartlead; he handles them manually.
- No CRM build. Smartlead + GoHighLevel cover post-reply workflows.
- No paid review APIs (Google Places, etc.). Use only existing scraped review data.
- No live web scraping at run time. All research uses pre-scraped Supabase data.

## 3. Architecture

```
                ┌──────────────────────────────────────┐
                │  VERCEL CRON (nightly 6 AM ET)       │
                │  app/api/cron/funnel/route.ts        │
                │  Verifies CRON_SECRET header         │
                └─────────────────┬────────────────────┘
                                  ▼
                ┌──────────────────────────────────────┐
                │  ORCHESTRATOR (TypeScript)           │
                │  1. idempotency lock check           │
                │  2. pull next 75 leads from Supabase │
                │     (Phase 1→4 + state secondary)    │
                │  3. fan out with Semaphore(5)        │
                └─────────────────┬────────────────────┘
                                  ▼
        ┌────────────┬────────────┴───────────┬────────────┐
        ▼            ▼                        ▼            │
  ┌─────────┐  ┌─────────┐              ┌─────────┐        │
  │RESEARCH │  │PERSONALI│              │ AUDIT   │        │
  │Sonnet4.6│→ │Opus 4.7 │ ───────────→ │Sonnet4.6│        │
  │JSON out │  │HTML diff│              │approve/ │        │
  │         │  │         │              │reject   │        │
  └─────────┘  └─────────┘              └─────────┘        │
                                              │            │
                                              ▼            │
                                  ┌────────────────────┐   │
                                  │ RENDER (TS)        │   │
                                  │ apply diffs to     │   │
                                  │ template → write   │   │
                                  │ to Vercel Blob     │   │
                                  └────────┬───────────┘   │
                                           │               │
                                           ▼               │
                                  ┌────────────────────┐   │
                                  │ SMARTLEAD PUSH     │   │
                                  │ POST campaigns/    │   │
                                  │   {id}/leads       │   │
                                  └────────┬───────────┘   │
                                           │               │
                                           ▼               │
                                  ┌────────────────────┐   │
                                  │ LOG run record to  │ ←─┘
                                  │ funnel_runs table  │
                                  └────────────────────┘
```

## 4. Components

### 4.1 Vercel Cron handler
**File:** `crm/app/api/cron/funnel/route.ts` (Next.js 16 Route Handler)

- Triggered by Vercel Cron config in `vercel.ts` at `0 11 * * *` UTC (6 AM ET)
- First action: verify `Authorization: Bearer ${CRON_SECRET}` header — reject anything else with 401
- Acquires idempotency lock by inserting a row in `funnel_runs` with `started_at`, `status='running'` for today's date — unique constraint on date prevents double-runs
- Calls orchestrator, awaits result, updates `funnel_runs` row with `status='completed'|'failed'`, counts, duration
- On failure, fires Twilio SMS to Kurt with the error summary (uses existing Twilio creds)
- Returns `{ ok: true, sent: N }` on success

### 4.2 Orchestrator
**File:** `crm/lib/funnel/orchestrator.ts`

- Pulls next batch of leads from Supabase using the phase ordering (see §5)
- Hard cap: never returns more than `MAX_DAILY_SENDS` leads (env var, default 75)
- Fans out per-lead processing with `p-limit(5)` — at most 5 leads in flight simultaneously
- Per-lead pipeline: research → personalize → audit → render → push
- Failures on individual leads are logged and skipped (don't poison the batch)
- Returns aggregated run summary

### 4.3 Research agent
**File:** `crm/lib/funnel/agents/research.ts`

- Inputs: lead row (`company_name`, `owner_name`, `city`, `state`, `phone`, `website`, `raw_site_text`, `review_samples`, `facebook_url`)
- Model: Sonnet 4.6 via `@anthropic-ai/sdk`
- System prompt: "extract personalization hooks from this small business data — the owner's likely tone, a quotable review, distinctive services, anything that would make a personalized landing page feel hand-researched"
- Output: structured JSON via Anthropic's tool-use mode:
  ```ts
  {
    best_review_quote: string | null,    // 1-2 sentences
    best_review_attribution: string | null, // e.g. "Sarah K., Buffalo customer"
    distinctive_services: string[],       // e.g. ["emergency 24/7", "boiler specialist"]
    local_callout: string | null,         // e.g. "serving the Elmwood neighborhood"
    tone_hint: "professional" | "folksy" | "urgent" | "established",
    visual_color_hint: string | null      // hex if their site has a clear brand color
  }
  ```
- ~3k input tokens, ~500 output tokens per call

### 4.4 Personalizer agent
**File:** `crm/lib/funnel/agents/personalizer.ts`

- Inputs: research JSON + lead row + the plumber-homepage template (read once, cached at module load)
- Model: **Opus 4.7** — the core of the system
- System prompt: "produce HTML diffs to inject into the template that personalize the landing page for this specific plumber. Quote their actual review. Reference their actual city. Don't fabricate anything not in the research JSON."
- Output: structured JSON via tool-use:
  ```ts
  {
    hero_tagline: string,           // e.g. "Built for Acme Plumbing & their Buffalo customers"
    review_block_html: string,      // <blockquote>...</blockquote>
    city_callout: string,           // appears in copy, e.g. "homeowners in Elmwood"
    color_overrides: { primary?: string, accent?: string } | null
  }
  ```
- ~5k input tokens (template is the bulk), ~1k output tokens per call
- This is the agent that justifies the daily Claude budget

### 4.5 Audit agent
**File:** `crm/lib/funnel/agents/audit.ts`

- Inputs: research JSON + personalizer output
- Model: Sonnet 4.6
- System prompt: "verify nothing in this personalization is fabricated. Every claim must trace back to the research data. Reject if you find any made-up review text, made-up city detail, or hallucinated business fact."
- Output:
  ```ts
  {
    approved: boolean,
    rejection_reason: string | null,
    fixed_personalization: object | null  // optional: the audit can return a corrected version
  }
  ```
- ~3k input tokens, ~200 output tokens per call
- If `approved: false` AND `fixed_personalization` is null → fall back to generic template (no personalization) for that lead, log a warning

### 4.6 Renderer
**File:** `crm/lib/funnel/render.ts`

- Inputs: lead slug + approved personalization
- Reads the cached `plumber-homepage.html` template
- Performs deterministic substitution at known anchor points:
  - `<!-- HERO_TAGLINE -->` → `personalization.hero_tagline`
  - `<!-- REVIEW_BLOCK -->` → `personalization.review_block_html`
  - `<!-- CITY_CALLOUT -->` → `personalization.city_callout`
  - `:root { --primary: ... }` updated if `color_overrides.primary` is set
- Writes the result to Vercel Blob: `funnel/{slug}.html` with `addRandomSuffix: false` for stable URLs
- Returns the public Blob URL

### 4.7 Landing page route
**File:** `crm/app/l/[slug]/page.tsx` (already exists from previous session)

- Modified to fetch the personalized HTML from Vercel Blob using the slug
- Falls back to the generic template if the personalized version doesn't exist (lead might have been queued but not yet processed)
- Renders the anchor-offer iframe below

### 4.8 Smartlead push
**File:** `crm/lib/funnel/smartlead.ts`

- Direct REST calls to Smartlead API at `https://server.smartlead.ai/api/v1/`
- Uses `SMARTLEAD_API_KEY` env var
- Pushes batch via `POST /campaigns/{id}/leads` with the full payload
- Each lead's `custom_fields.landing_url` is set to `https://{vercel_domain}/l/{slug}`
- Implements exponential backoff with jitter on 429: 1s, 2s, 4s, then fail-and-skip
- Returns count pushed + count failed

### 4.9 Supabase tables (additions)
**Migrations:** `migrations/010_funnel_runs.sql`, `migrations/011_lead_funnel_state.sql`

```sql
-- Track each nightly run
create table funnel_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null unique,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'completed', 'failed')),
  leads_attempted int default 0,
  leads_sent int default 0,
  leads_failed int default 0,
  agent_token_usage jsonb,  -- { research_in, research_out, personalize_in, ... }
  error_summary text
);
create index idx_funnel_runs_date on funnel_runs (run_date);

-- Track per-lead funnel state (so we never re-send)
create table lead_funnel_state (
  lead_id uuid primary key references leads(id) on delete cascade,
  slug text unique not null,                        -- URL slug, derived once per lead
  personalized_at timestamptz,                       -- when the landing page was generated
  pushed_to_smartlead_at timestamptz,                -- when the lead was pushed
  smartlead_lead_id text,                            -- Smartlead's internal ID
  status text not null default 'pending'             -- pending | personalized | sent | replied | bounced | unsubscribed
    check (status in ('pending','personalized','sent','replied','bounced','unsubscribed','suppressed')),
  phase int not null check (phase between 1 and 4),  -- which quality phase
  last_event_at timestamptz default now()
);
create index idx_lead_funnel_state_status on lead_funnel_state (status);
create index idx_lead_funnel_state_phase on lead_funnel_state (phase, status);
```

### 4.10 Smartlead webhook handler
**File:** `crm/app/api/webhooks/smartlead/route.ts`

- Receives webhook events from Smartlead (reply, bounce, unsubscribe)
- Verifies signature
- Updates `lead_funnel_state.status` accordingly
- Replied/bounced/unsubscribed leads never get re-queued

## 5. Lead selection (Phase ordering)

The orchestrator selects leads using this query each night:

```sql
select l.*, e.*
from leads l
join lead_enrichment e on e.lead_id = l.id
left join lead_funnel_state s on s.lead_id = l.id
where l.status = 'enriched'
  and e.email is not null
  and (s.status is null or s.status = 'pending')
  and not exists (
    select 1 from lead_funnel_state s2
    where s2.lead_id = l.id
    and s2.status in ('sent', 'replied', 'bounced', 'unsubscribed', 'suppressed')
  )
order by
  case
    when e.owner_name is not null and e.review_samples is not null then 1
    when e.owner_name is not null and e.review_samples is null     then 2
    when e.owner_name is null     and e.review_samples is not null then 3
    else                                                                4
  end asc,
  case l.state when 'NY' then 1 when 'PA' then 2 when 'NJ' then 3
               when 'CT' then 4 when 'MA' then 5 else 6 end asc,
  l.id asc
limit 75;
```

**Phase progression** is automatic — when Phase 1 leads run out, Phase 2 takes over, and so on. No manual intervention.

**Auto-pause guard:** If the most recent 7-day reply rate for the current phase falls below `MIN_REPLY_RATE_PCT` (env var, default 1.5%), the orchestrator pauses promotion to the next phase, sends Kurt an SMS, and exits without sending. Kurt manually resumes by inserting a row in `funnel_runs` with `status='resumed_manually'`.

## 6. Security posture

| Concern | Mitigation |
|---|---|
| Cron endpoint hijacking | `Authorization: Bearer ${CRON_SECRET}` verified on every call; 401 otherwise |
| Secrets in repo | All keys in Vercel env vars (`ANTHROPIC_API_KEY`, `SMARTLEAD_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) |
| Anthropic rate limits | Per-window concurrency cap via `p-limit(5)`, exponential backoff on 429, fail-and-skip after 3 retries |
| Smartlead rate limits | Same backoff pattern; chunk pushes to ≤50 leads per request |
| Accidental double-send | Daily idempotency lock (unique constraint on `funnel_runs.run_date`) + `lead_funnel_state` status check |
| Hallucinated personalization | Audit agent rejects, falls back to generic template, logs warning |
| PII leakage in logs | Lead emails are hashed in Vercel function logs; full data only in Supabase |
| Webhook spoofing | Smartlead webhook signature verified before processing (per Smartlead's docs at smartlead.ai/api/webhooks; signature scheme to be confirmed during implementation, fallback to shared secret in URL path if signing not supported) |
| Daily volume runaway | Hard cap `MAX_DAILY_SENDS` env var enforced in code regardless of input |

## 7. Testing

- **Unit:** Each agent has a Vitest spec with mocked Anthropic SDK, asserting JSON shape and graceful failures (timeout, malformed response, content_filter)
- **Integration:** End-to-end test with 3 fixture leads, mocking Anthropic + Smartlead APIs, asserting that personalization → render → push happens correctly and `funnel_runs` + `lead_funnel_state` get the right writes
- **Smoke test:** Manual `curl` against `/api/cron/funnel` in dev with `CRON_SECRET=test`, watching the function logs and verifying 3 demo leads land in Smartlead's "Test Campaign" without actually sending
- **Acceptance gate before production:** Run a full nightly batch in dry-run mode (set `DRY_RUN=true` env var to skip the actual Smartlead push), inspect 5 random personalized landing pages manually, verify zero hallucinations

## 8. Open Items (resolved before plan execution)

- Supabase project must be unfrozen (Kurt's Pro upgrade pending tonight)
- Vercel project must have `CRON_SECRET`, `ANTHROPIC_API_KEY`, `SMARTLEAD_API_KEY`, `SUPABASE_*` env vars set
- Smartlead campaign ID for "Anchor Frame Plumbers" must be created and ID captured into `SMARTLEAD_CAMPAIGN_ID` env var
- Vercel Blob namespace `funnel/` must be created
- One Smartlead webhook must be registered: `https://{vercel_domain}/api/webhooks/smartlead` for reply/bounce/unsubscribe events

## 9. Cost estimate (per Anthropic Max plan)

At 75 leads/day:
- 75 Opus calls (personalize): ~25 per 5-hour window
- 150 Sonnet calls (research + audit): ~50 per 5-hour window
- Max plan capacity per window: ~150-200 Opus messages, ~250-400 Sonnet messages
- Utilization: ~15% of Opus quota, ~15% of Sonnet quota
- Marginal cost: $0 (covered by Max subscription)

At 500 leads/day (future):
- 500 Opus + 1000 Sonnet daily, ~167 Opus + 333 Sonnet per window
- Opus tight on Max — trigger to switch to API billing ($0.075/lead Opus = $37.50/day) or downgrade non-HOT leads to Sonnet
