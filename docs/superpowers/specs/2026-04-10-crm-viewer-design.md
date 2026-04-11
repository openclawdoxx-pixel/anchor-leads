# Anchor Leads CRM Viewer — Design Spec

**Date:** 2026-04-10
**Project:** anchor-leads (Phase 1.5)
**Status:** approved for planning

---

## 1. Purpose

Give the user and their team a fast, opinionated web UI for cold-calling the leads produced by the scraper (Phase 1). The primary workflow is "sit down, call 50 plumbers, log outcomes, move on." The UI must make that loop as fast as possible and must never require jumping into Supabase's raw table editor.

Deferred to later phases: Twilio-powered in-browser dialer, AI call transcription + coaching, automatic lead assignment, per-user quotas.

## 2. Scope (v1)

- Filterable, groupable lead list with saved "lens" views
- Split-view layout: sidebar + list + detail panel
- Detail panel with three tabs: Intel, Script, Call Log
- Call outcome logging per call, attributed to the caller
- Script loader (markdown files, one per offer pillar) with objection handling
- Team performance page: leaderboard + per-day calls chart + per-user drilldown
- Supabase Auth with email/password, invite-only team signup
- Vercel deployment

**Explicitly out of scope:**
- Twilio / in-browser dialing
- Call recording, transcription, AI coaching
- Per-user lead assignment and lead ownership
- Goal tracking, quotas, commission calculations
- Email integration, SMS from CRM
- Mobile-specific layouts (must work on a laptop; mobile is a nice-to-have, not required)
- Editing enrichment data or re-running the scraper from the UI

## 3. Tech Stack

- **Next.js 15** (App Router) deployed to **Vercel**
- **TypeScript** throughout
- **Tailwind CSS + shadcn/ui** component library
- **@supabase/ssr** for database queries and session management (cookie-based auth)
- **Zustand** for small amount of client state (selected lead ID, active filters)
- **React Server Components** for all list/read queries (no client-side loading spinners for data fetches)
- **React hook form + zod** for the call log form validation
- **All free tier** — Vercel free tier, Supabase free tier

## 4. Data Model (additions to Supabase)

Three new tables. The existing scraper tables (`leads`, `lead_enrichment`, `lead_notes`, `scraper_runs`) are untouched.

```sql
-- Team members, joined 1:1 with Supabase auth.users
create table team_members (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'caller',  -- 'owner' | 'admin' | 'caller'
  created_at  timestamptz not null default now()
);

-- Every call attempt logged
create table call_logs (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  caller_id   uuid not null references team_members(id),
  outcome     text not null,      -- see §7
  notes       text,
  pitch_used  text,               -- which of the 5 pillars
  duration_s  int,                -- optional, manual for now
  created_at  timestamptz not null default now()
);
create index on call_logs (lead_id, created_at desc);
create index on call_logs (caller_id, created_at desc);
create index on call_logs (created_at desc);

-- Saved filter views, shared across the team
create table saved_views (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  filters     jsonb not null,
  created_by  uuid references team_members(id),
  is_shared   boolean default true,
  sort_order  int default 0,
  created_at  timestamptz not null default now()
);
```

### Computed view for list rendering

```sql
create view leads_with_latest_call as
select
  l.*,
  e.review_count,
  e.rating,
  e.owner_name,
  e.site_builder,
  e.booking_path_quality,
  n.best_pitch,
  n.digital_maturity,
  n.ai_summary,
  (select outcome from call_logs cl where cl.lead_id = l.id order by cl.created_at desc limit 1) as latest_outcome,
  (select created_at from call_logs cl where cl.lead_id = l.id order by cl.created_at desc limit 1) as latest_call_at
from leads l
left join lead_enrichment e on e.lead_id = l.id
left join lead_notes n on n.lead_id = l.id;
```

The list UI reads from this view. Detail panel reads from the underlying tables directly.

### Row-level security

Everyone on the team sees all leads and all call logs. RLS policy: authenticated user must have a row in `team_members`. No per-user scoping in v1.

## 5. Layout

A three-pane split view on the main leads page:

```
┌─────────────────────────────────────────────────────────────────┐
│ Top bar: logo │ saved-views dropdown │ search │ /team │ user   │
├──────────┬───────────────────────────┬──────────────────────────┤
│ Sidebar  │  Lead list (middle)       │  Lead detail (right)     │
│          │                           │                          │
│ LENSES   │  [filter chips row]       │  header: name, phone,    │
│ · Bad    │                           │  rating, owner           │
│   site   │  scrollable rows:         │                          │
│ · Low    │  company • city • reviews │  [Intel | Script | Call] │
│   revs   │  best_pitch pill          │                          │
│ · Owner  │  last outcome dot         │  tab content updates as  │
│   known  │                           │  you click leads         │
│          │  keyboard: j/k navigate   │                          │
│ + New    │                           │                          │
└──────────┴───────────────────────────┴──────────────────────────┘
```

### Sidebar (left)
- "Lenses" header
- List of saved views (clicking applies the view's filter JSON)
- `+ New lens` button (captures current filter state, prompts for a name)
- User menu at bottom (name, `/team` link, sign out)

### Lead list (middle pane)
- Filter chips row at top (state, best_pitch, max_reviews, has_owner, site_builder, call status)
- Virtualized list of rows — each row: `company_name` · `city, state` · `12 reviews` · `[best_pitch pill]` · latest-call dot
- Click a row → updates the detail panel via Zustand store
- Keyboard: `j`/`↓` next, `k`/`↑` prev, `/` focus search, `g` go to top
- Shows a count badge at top ("247 leads in this view")

### Lead detail (right pane)
Three tabs: **Intel** (default), **Script**, **Call Log**.

**Intel tab** — renders `lead_notes` + `lead_enrichment`:
- Header card: company name, phone (tel: link), rating stars, review count, owner name
- AI summary paragraph
- Attack angles as bulleted list, each tagged with the pitch pillar it hits
- Review themes as bulleted list
- Site signals row: site_builder badge, booking_path_quality badge, chat_widget badge, last_update_year
- Facebook link if present, last post date

**Script tab** — markdown rendering:
- Pillar dropdown at top, auto-selected to the lead's `best_pitch`
- Loads `/scripts/<pillar>.md` from the Next.js project
- Main script section rendered as markdown
- Collapsible "Objections" section underneath

**Call Log tab**:
- New call form: outcome dropdown, pitch_used dropdown (pre-filled), notes textarea, [Save & Next] button
- Timeline of prior calls on this lead below the form (caller name, outcome badge, notes, timestamp)

## 6. Filters and Saved Views (§5 middle pane detail)

Filter fields in v1 (stored as `saved_views.filters` JSON):

- `state: string[]` (multi)
- `city: string` (free text contains)
- `best_pitch: string[]` (multi of the 5 pillars)
- `review_count_max: number`
- `review_count_min: number`
- `has_owner_name: boolean`
- `site_builder: string[]` (multi)
- `booking_path_quality: string[]` (multi)
- `call_status: "never_called" | "no_answer_recent" | "called_today" | "any"`
- `digital_maturity_max: number`

### Pre-seeded saved views (created on first login)

1. **Never Called** — `call_status = never_called`
2. **Bad Website, Owner Known** — `site_builder in (wix, godaddy, none)` + `has_owner_name = true`
3. **Low Reviews, Any Pitch** — `review_count_max = 25`
4. **MCB Pitch, NY+PA** — `best_pitch = mcb` + `state in (NY, PA)`
5. **No Answer — Retry Today** — `call_status = no_answer_recent`

### Saving new views

A "+ Save this view" button appears whenever filters differ from the active saved view. Clicking prompts for a name and inserts a row into `saved_views`. All views are shared across the team in v1.

## 7. Call Outcome Taxonomy

Exactly 10 outcomes:

| outcome | label | terminal? |
|---|---|---|
| `no_answer` | No answer | no |
| `voicemail` | Voicemail | no |
| `bad_number` | Bad number | yes (marks lead rejected) |
| `gatekeeper` | Gatekeeper | no |
| `rejected` | Rejected | no |
| `callback` | Callback requested | no |
| `interested` | Interested | no |
| `booked_demo` | Booked demo | yes (marks lead active) |
| `closed_won` | Closed — won | yes (marks lead won) |
| `do_not_call` | Do not call | yes (marks lead DNC) |

"Terminal" outcomes automatically update the `leads.status` to an appropriate new value so terminal leads drop out of the "Never Called" lens and similar. A new lead status enum is added: `rejected_by_call`, `active_pipeline`, `won`, `dnc`. These are distinct from the scraper's `rejected` (ICP failure) and `enriched` (scraper-output) values.

## 8. Script Loader

Scripts live as markdown files in the Next.js repo at `/app/scripts/<pillar>.md`. One file per offer pillar:

- `website.md`
- `mcb.md`
- `chat_ai.md`
- `reputation.md`
- `ghl_crm.md`

Each file follows this structure:

```markdown
# [Pillar Title]

## Opener
...

## Discovery
...

## Pitch
...

## Objections
### "I already have a website"
...

### "I'm too busy"
...
```

The Script tab reads the markdown at build time (imported as a module) and renders it with `react-markdown`. The "Objections" section is collapsible by default — the rest is always visible.

The user seeds the initial five script files with their current script content after the CRM is deployed. Updates are made via git commits to the scripts folder — no in-app editing in v1.

## 9. Team Performance Page (`/team`)

A single page, three widgets:

### Weekly leaderboard
Table: name, calls this week, interested count, booked count, won count. Sorted by calls desc.

### Calls per day chart
Stacked area chart (recharts `AreaChart` with `stackId`) showing total calls per day for the last 30 days, one layer per teammate. Uses `call_logs.created_at` grouped by day + caller. Colors assigned deterministically by `team_members.id` hash so a given user always has the same color.

### Per-user drilldown
Click a row in the leaderboard → modal with:
- The same metrics for just that user
- Their 20 most recent call logs with lead company name, outcome, notes

### Invite flow
The `/team` page also has an "Invite teammate" button (visible to `owner` and `admin` roles). Opens a modal, takes email + full name + role, calls Supabase Auth's `inviteUserByEmail`, creates a pending `team_members` row. The invitee receives a magic link, sets a password, lands on the main page.

## 10. Auth & Session

- **Bootstrap:** on first deploy, no users exist. The user (owner) signs up via a bootstrap route that only works if the `team_members` table is empty, and assigns role `owner`.
- **Subsequent logins:** email + password, session stored in a cookie via `@supabase/ssr`, works across server-side rendering.
- **Middleware:** a Next.js middleware redirects unauthenticated users to `/login` for all routes except `/login`, `/invite-accept`, and the bootstrap route.
- **RLS policy on all tables:** `auth.uid() in (select id from team_members)`. Unauthenticated users see nothing.

## 11. File Structure

```
anchor-leads/
├── crm/                           # the Next.js app (sibling to the Python scraper)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx               # main split view
│   │   ├── login/page.tsx
│   │   ├── bootstrap/page.tsx
│   │   ├── team/page.tsx
│   │   ├── api/                   # server actions
│   │   │   ├── leads/route.ts     # list endpoint with filter
│   │   │   ├── call-logs/route.ts # POST new call log
│   │   │   └── saved-views/route.ts
│   │   └── scripts/               # markdown files
│   │       ├── website.md
│   │       ├── mcb.md
│   │       ├── chat_ai.md
│   │       ├── reputation.md
│   │       └── ghl_crm.md
│   ├── components/
│   │   ├── ui/                    # shadcn components
│   │   ├── lead-list.tsx
│   │   ├── lead-detail/
│   │   │   ├── index.tsx
│   │   │   ├── intel-tab.tsx
│   │   │   ├── script-tab.tsx
│   │   │   └── call-log-tab.tsx
│   │   ├── sidebar.tsx
│   │   ├── filter-chips.tsx
│   │   └── team/
│   │       ├── leaderboard.tsx
│   │       └── calls-chart.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts
│   │   │   ├── client.ts
│   │   │   └── middleware.ts
│   │   ├── filters.ts             # filter JSON → SQL where clause
│   │   └── store.ts               # zustand store
│   ├── migrations/                # CRM-only migrations, appended after scraper's
│   │   ├── 005_team_members.sql
│   │   ├── 006_call_logs.sql
│   │   ├── 007_saved_views.sql
│   │   └── 008_leads_view.sql
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── next.config.js
│   └── .env.local                 # NEXT_PUBLIC_SUPABASE_URL + ANON_KEY
```

The CRM is a sibling Next.js project under the same repo. Scraper (Python) and CRM (Next.js) don't share code — they share the Supabase database as the contract.

## 12. Deployment

- **Vercel project** linked to the `anchor-leads` repo, root set to `crm/`
- Environment variables on Vercel:
  - `NEXT_PUBLIC_SUPABASE_URL` (same as scraper's)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the public anon key — NOT the service_role key)
  - `SUPABASE_SERVICE_ROLE_KEY` (server-side only, used in middleware)
- **Branch:** `main` deploys to production. Preview deploys on every PR.
- **Custom domain:** optional; Vercel assigns a `*.vercel.app` by default. User can add `crm.anchorframe.com` later.

## 13. Error Handling & Observability

- All server actions wrapped in try/catch, errors logged to console and returned as `{error: string}` to the client
- Failed call log saves show a toast, don't advance to next lead
- No Sentry / no OTel in v1 — Vercel's built-in logs are enough at this scale
- Database errors from RLS violations should redirect to `/login` (session expired)

## 14. What the User Sees After Shipping

- Log in at `crm.<whatever>.vercel.app` with email/password
- Land on the leads page, see the "Never Called" lens already selected, hundreds of leads on the left
- Click a lead → see full Intel on the right instantly
- Switch to the Script tab → read the pitch for the auto-selected pillar
- Call the lead (externally, on the user's existing power dialer for now)
- Switch to Call Log → pick outcome → add notes → Save & Next → list auto-advances
- Click "+ New lens" after building up filters they like → becomes a one-click preset
- Click `/team` → see the leaderboard, who's calling, how they're doing

## 15. Phase 2 (not in this spec, just noted for continuity)

- Twilio dialer + click-to-call from the detail panel
- Call recording + transcription (AssemblyAI or Whisper) → auto-filled notes
- Live AI coaching during the call (objection suggestions from a side panel)
- Per-user lead assignment + "My Queue" view
- Script editing in-app (replaces git-based workflow)
- Email cadence integration (separate system — the 3 warmed domains)
