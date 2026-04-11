# Plumber Lead Scraper & Enrichment Pipeline — Design Spec

**Date:** 2026-04-10
**Project:** anchor-leads (foundation phase)
**Author:** pair-designed with the user
**Status:** draft for review

---

## 1. Purpose

Build a pipeline that discovers, filters, enriches, and scores small US plumbing businesses into a Supabase database so the user can (a) view them in the Supabase Table Editor tonight, (b) hit them with cold calls, and (c) feed them into downstream systems (landing pages, cold email, dialer) in later phases.

This is **phase 1 of a larger system**. Everything else (CRM UI, cold email engine, landing pages, power dialer) is explicitly out of scope for this spec.

## 2. Target Customer Profile (ICP)

The user sells a lead-recovery stack (website + missed-call text-back + chat→SMS AI + reputation management + GHL CRM, free setup, $75/booked job). The ICP is plumbers who will benefit most:

- **US-based**, starting in NY, then PA, then Northeast, then outward
- **Under 100 Google reviews** (small operators, not franchises)
- **No AI/chatbot** on their site (Intercom, Drift, Tidio, Tawk, HubSpot, GHL, custom)
- **Bad or missing website** — defined concretely as any of:
  - No website at all
  - `site_builder IN ('wix', 'godaddy', 'none')`
  - `last_site_update_year <= current_year - 3`
  - **Weak booking path**: hero section has no clear CTA to call/book, OR no visible phone-link/booking form above the fold, OR generic "contact us" copy instead of an actionable booking prompt
- **Must have a phone number** (can't cold call without it)

Leads outside the ICP are not deleted — they are marked `rejected` so the rules can be re-run later if the ICP changes.

## 3. Architecture

Four loosely-coupled stages. Each stage reads from and writes to Supabase, so any stage can crash and resume without losing work.

```
[1. Discover]  →  [2. Filter]  →  [3. Enrich]  →  [4. Score]
  Overture Maps     ICP rules      gstack fetch     LLM writes
  dataset download  applied via    + owner lookup   notes JSON
  → insert into     pure SQL       + site analysis  + best_pitch
  leads table
```

**Stage separation rationale:** a monolithic scraper loses all work on crash. With stage separation, every step is resumable, every stage can be re-run with new logic without touching the others, and the leads table fills up in real time so the user can watch progress in the Supabase dashboard.

### 3.1 Stage 1 — Discover (Overture Maps)

- Download the relevant tile of the Overture Maps `places` dataset (free, open, backed by Meta/Microsoft/Amazon/TomTom).
- Filter to `category = plumber` (and related plumbing categories Overture uses).
- For each place, insert a row into `leads` with `status = 'discovered'`.
- Dedupe by `overture_id`.
- **No network scraping happens here.** Overture is a local parquet/GeoJSON download. Runtime: ~10 minutes for the full US.

### 3.2 Stage 2 — Filter (pure SQL)

- A single SQL statement marks leads as `qualified` or `rejected` based on ICP rules that can be checked from Overture alone (state, has phone, has address).
- Rules that require enrichment data (review count <100, website quality, chat widget presence) are applied in stage 3 after the data is fetched. Stage 2 is the cheap pre-filter; stage 3 is the expensive post-filter.

### 3.3 Stage 3 — Enrich (gstack browser + direct HTTP)

> `gstack` is the headless browser skill already installed on this machine (see the skill list). It handles stealth, user-agent rotation, and page interaction. All browser-based fetches in this stage go through gstack rather than raw Playwright.


For each lead with `status = 'qualified'`:

1. **Website analysis** (if website exists):
   - Fetch homepage + About page via `gstack`
   - Detect site builder from meta tags / footer (WordPress, Wix, GoDaddy, Squarespace, custom, none)
   - Detect chat widget by scanning page scripts for known vendor strings: `intercom.io`, `drift.com`, `tidio`, `tawk.to`, `hubspot`, `gohighlevel`, plus generic `chatbot|ai assistant|powered by` patterns
   - Capture last-updated year from footer copyright
   - Capture hero section text and above-the-fold CTAs into `hero_snapshot` for booking-path analysis
   - Save full raw page text to `raw_site_text` for LLM consumption in stage 4
2. **Google Place ID + review data:**
   - Search Google Maps via gstack for the company + city, extract Place ID, review count, rating
   - Pull top 5 reviews sorted by lowest rating first (bad reviews = better sales ammo)
3. **Owner name lookup** (in order, stop at first hit):
   - Parse About page for patterns: `owner`, `founder`, `meet <Name>`, `established by`
   - Scan top reviews for `the owner <Name>` patterns
   - Google search `"<company> owner"` as fallback
4. **Facebook lookup:**
   - Google search `"<company> facebook"`, visit if found, extract last post date
5. **Apply final ICP filters** (review count <100, digital maturity):
   - If lead fails final filter → `status = 'rejected'`
   - Else → `status = 'enriched'`
6. Retry policy: 3 attempts with exponential backoff. Persistent failure → `status = 'enrichment_failed'`.

### 3.4 Stage 4 — Score (LLM pass)

For each lead with `status = 'enriched'`:

- Feed the LLM: the `lead_enrichment` row + a system prompt containing the user's offer pillars.
- Ask for a structured JSON output matching the `lead_notes` schema.
- The system prompt lives in a single file so the user can tune it without touching code.
- Model: Claude Haiku 4.5 (fast, cheap, structured output is reliable at this task complexity). Swap to Sonnet only if eval shows quality issues.
- On success → `status = 'scored'`.

## 4. Data Model (Supabase)

Three tables. Each stage owns its own table so stages can be re-run independently.

```sql
-- Stage 1-2 output
create table leads (
  id              uuid primary key default gen_random_uuid(),
  overture_id     text unique,
  place_id        text unique,
  company_name    text not null,
  phone           text,
  website         text,
  address         text,
  city            text,
  state           text not null,
  lat             double precision,
  lng             double precision,
  status          text not null default 'discovered',
    -- 'discovered' | 'qualified' | 'rejected'
    -- | 'enriched' | 'enrichment_failed' | 'scored'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on leads (status);
create index on leads (state);

-- Stage 3 output
create table lead_enrichment (
  lead_id                uuid primary key references leads(id) on delete cascade,
  owner_name             text,
  review_count           int,
  rating                 float,
  site_builder           text,   -- 'wordpress' | 'wix' | 'godaddy' | 'squarespace' | 'custom' | 'none'
  has_chat_widget        boolean,
  chat_widget_vendor     text,
  has_ai_signals         boolean,
  last_site_update_year  int,
  hero_snapshot          jsonb,  -- {hero_text, above_fold_ctas:[], has_phone_link, has_booking_form}
  booking_path_quality   text,   -- 'strong' | 'weak' | 'none'
  facebook_url           text,
  facebook_last_post     date,
  review_samples         jsonb,  -- [{rating, text, date}, ...]
  raw_site_text          text,
  enriched_at            timestamptz not null default now()
);

-- Stage 4 output
create table lead_notes (
  lead_id          uuid primary key references leads(id) on delete cascade,
  attack_angles    jsonb,   -- array of strings
  review_themes    jsonb,   -- array of strings
  digital_maturity int,     -- 1-10
  ai_summary       text,
  best_pitch       text,    -- 'website' | 'mcb' | 'chat_ai' | 'reputation' | 'ghl_crm'
  scored_at        timestamptz not null default now()
);

-- Run log
create table scraper_runs (
  id         uuid primary key default gen_random_uuid(),
  stage      text not null,   -- 'discover' | 'filter' | 'enrich' | 'score'
  state      text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  processed  int,
  succeeded  int,
  failed     int,
  notes      text
);
```

## 5. CLI Surface

A single `scraper` binary with four subcommands. Each is idempotent — re-running on the same leads produces the same result.

```bash
./scraper discover --state NY        # Overture download → leads table
./scraper filter                     # Apply ICP SQL filter
./scraper enrich  --limit 500        # Enrich next 500 qualified leads
./scraper score   --limit 500        # LLM-score next 500 enriched leads
```

`enrich` and `score` also accept `--loop` for continuous background operation on the Mac mini. A systemd-equivalent (launchd on macOS) service is out of scope for this spec but will be added in a follow-up.

## 6. Error Handling & Resume

- **Idempotency:** every stage's work is keyed by `lead_id` + `status`. Re-running a stage on the same lead overwrites the row in its stage-owned table. No duplicate work.
- **Crash recovery:** stages query `WHERE status = <previous stage>` to find work. Crashes mid-run just mean some leads moved forward and the rest didn't — next run picks up the rest.
- **Network errors:** 3 retries with exponential backoff (1s, 4s, 16s). Persistent failure → mark lead with a `_failed` status and continue. Failed leads can be retried later with `--retry-failed`.
- **Observability:** every run inserts a row in `scraper_runs`. User can query: *"how many leads did I enrich last night and how many failed?"*
- **Rate limiting:** gstack calls to Google Maps are spaced with jitter (random 2–6 second delay) to avoid triggering bot detection.

## 7. Secrets & Configuration

Environment variables in `.env` at the project root, never committed:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

The scoring stage's LLM prompt lives in `prompts/score_lead.md` so it can be tuned without code changes.

## 8. What The User Sees Tonight

- Supabase project with three tables populated
- NY leads visible in the Supabase Table Editor dashboard
- Ability to filter by `best_pitch`, sort by `digital_maturity`, open any row to see the full enrichment + notes JSON
- A scraper process running continuously in the background, moving leads forward through the stages

## 9. Out of Scope (explicit)

- CRM UI beyond Supabase Table Editor (deferred to **Phase 1.5: Lead Viewer**, a Next.js app on Vercel with Supabase Auth)
- Cold email engine, copywriting agent, warmup domain integration
- Personalized landing pages, paywall handoff to anchorframe.com/anchor
- Power dialer, Twilio integration, AI call coaching
- Cowork/dispatch voice workflow setup
- Mac-wide file organization system
- Full US scrape beyond NY/PA/NE on night one — geographic expansion is gradual over the 2-week warmup window

## 10. Phase 1.5 (follow-up, not this spec)

Minimal Next.js "Lead Viewer" deployed to Vercel free tier:
- One page, reads from Supabase via the JS client
- Sales-card UI showing company, phone (click-to-call), rating, attack angles, best pitch, AI summary, editable notes textarea
- Supabase Auth for team login
- No pipeline stages, no activity log, no dialer integration — that's the real CRM in a later phase
