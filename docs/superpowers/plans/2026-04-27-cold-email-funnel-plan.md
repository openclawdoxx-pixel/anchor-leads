# Cold Email Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel-Cron-triggered nightly pipeline that personalizes a landing page per lead (Haiku research → Opus personalize → Sonnet audit), uploads to Vercel Blob, and pushes the prepared leads to Smartlead via REST.

**Architecture:** TypeScript orchestrator runs in a Vercel Function on a daily cron. Three Anthropic models split by job: Haiku 4.5 extracts research JSON, Opus 4.7 produces HTML diffs, Sonnet 4.6 audits for hallucinations. Renderer applies diffs to the existing plumber-homepage template and writes to Vercel Blob. Each lead's `/l/{slug}` route serves the personalized HTML via a sandboxed iframe pointing at the Blob URL stored in `lead_funnel_state` (no dangerouslySetInnerHTML — Blob is sandboxed, no XSS surface in our React tree). Smartlead handles all send-side concerns. Idempotency + 5 layers of rate limiting per spec §6.

**Tech Stack:** Next.js 16.2.3 (App Router), TypeScript, Vitest, `@anthropic-ai/sdk`, `@vercel/blob`, `@supabase/supabase-js` (already installed), Smartlead REST API via `fetch`, Twilio SDK for alerts.

**Spec:** [docs/superpowers/specs/2026-04-27-cold-email-funnel-design.md](../specs/2026-04-27-cold-email-funnel-design.md)

---

## Pre-flight Checklist

Before Task 1, the following external state must be true:

- [ ] **Supabase project unfrozen.** Currently restricted on `exceed_egress_quota`. Kurt's Pro upgrade resolves this. No DB integration tests can pass until this is done.
- [ ] **Vercel project linked** to `crm/` directory. Run `vercel link` from the crm/ folder if not already linked.
- [ ] **Vercel Blob store created.** `vercel storage add blob` from `crm/` directory; capture the resulting `BLOB_READ_WRITE_TOKEN` for env vars.
- [ ] **Smartlead campaign created** in Smartlead UI named "Anchor Frame Plumbers" — capture the campaign ID for `SMARTLEAD_CAMPAIGN_ID` env var.
- [ ] **Smartlead API key** copied from Smartlead settings → API.
- [ ] **Anthropic API key** for `ANTHROPIC_API_KEY` (already in Kurt's .env for the scraper — re-use).

---

## File Structure

**New files:**

```
crm/
├── lib/funnel/
│   ├── types.ts                      # Lead, ResearchOutput, PersonalizationOutput, AuditResult, RunSummary
│   ├── anthropic-client.ts           # SDK wrapper: 429 backoff, model constants
│   ├── twilio-alert.ts               # SMS notification helper
│   ├── supabase-funnel.ts            # funnel_runs + lead_funnel_state writes
│   ├── lead-selector.ts              # Phase 1→4 ordering + slug + phase computation
│   ├── render.ts                     # Apply diffs to template, upload to Blob
│   ├── smartlead.ts                  # Smartlead REST client
│   ├── orchestrator.ts               # Main fan-out pipeline
│   └── agents/
│       ├── research.ts               # Haiku 4.5 — extract personalization hooks
│       ├── personalizer.ts           # Opus 4.7 — produce HTML diffs
│       └── audit.ts                  # Sonnet 4.6 — hallucination check
├── app/api/cron/funnel/route.ts      # Vercel Cron endpoint
├── app/api/webhooks/smartlead/route.ts # Reply/bounce/unsubscribe handler
├── app/l/[slug]/page.tsx             # MODIFY: lookup blob URL in Supabase, iframe it
└── vercel.ts                         # MODIFY/CREATE: cron config

crm/lib/funnel/__tests__/
├── anthropic-client.test.ts
├── lead-selector.test.ts
├── render.test.ts
├── smartlead.test.ts
└── orchestrator.test.ts

crm/lib/funnel/agents/__tests__/
├── research.test.ts
├── personalizer.test.ts
└── audit.test.ts

migrations/
├── 010_funnel_runs.sql
└── 011_lead_funnel_state.sql

crm/public/templates/
└── plumber-homepage.html              # No edits — renderer uses Cheerio selectors
```

---

## Task 1: Install dependencies

**Files:**
- Modify: `crm/package.json`

- [ ] **Step 1: Install runtime + dev dependencies**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm install @anthropic-ai/sdk @vercel/blob twilio p-limit cheerio
npm install -D @vercel/config msw
```

- [ ] **Step 2: Verify install**

```bash
npm list @anthropic-ai/sdk @vercel/blob twilio p-limit cheerio msw @vercel/config
```

Expected: each package listed with a version, no UNMET PEER warnings.

- [ ] **Step 3: Commit**

```bash
git add crm/package.json crm/package-lock.json
git commit -m "chore(crm): add funnel dependencies (anthropic, blob, twilio, p-limit, cheerio, msw, @vercel/config)"
```

---

## Task 2: Migration 010 — funnel_runs table

**Files:**
- Create: `migrations/010_funnel_runs.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migrations/010_funnel_runs.sql
-- Track each nightly funnel batch. Unique constraint on run_date enforces
-- daily idempotency — a second insert on same date will fail.

create table if not exists funnel_runs (
  id                  uuid primary key default gen_random_uuid(),
  run_date            date not null unique,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  status              text not null check (status in ('running', 'completed', 'failed', 'resumed_manually')),
  leads_attempted     int default 0,
  leads_sent          int default 0,
  leads_failed        int default 0,
  agent_token_usage   jsonb,
  error_summary       text
);

create index if not exists idx_funnel_runs_started on funnel_runs (started_at desc);
```

- [ ] **Step 2: Apply migration in Supabase SQL editor**

Open `https://supabase.com/dashboard/project/tfhfzwwyoezpcmbyfnqm/sql/new`, paste, run.

- [ ] **Step 3: Verify**

```sql
select column_name from information_schema.columns where table_name = 'funnel_runs';
```

Expected: 9 rows.

- [ ] **Step 4: Commit**

```bash
git add migrations/010_funnel_runs.sql
git commit -m "feat(db): migration 010 — funnel_runs table for daily batch tracking"
```

---

## Task 3: Migration 011 — lead_funnel_state table

**Files:**
- Create: `migrations/011_lead_funnel_state.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migrations/011_lead_funnel_state.sql
-- Per-lead funnel status. One row per lead that has ever entered the funnel.
-- personalized_blob_url is the public Vercel Blob URL for that lead's HTML —
-- the /l/{slug} page reads this and serves it in a sandboxed iframe.

create table if not exists lead_funnel_state (
  lead_id                 uuid primary key references leads(id) on delete cascade,
  slug                    text unique not null,
  personalized_at         timestamptz,
  personalized_blob_url   text,
  pushed_to_smartlead_at  timestamptz,
  smartlead_lead_id       text,
  status                  text not null default 'pending'
                          check (status in ('pending','personalized','sent','replied','bounced','unsubscribed','suppressed')),
  phase                   int not null check (phase between 1 and 4),
  last_event_at           timestamptz default now()
);

create index if not exists idx_lead_funnel_state_status on lead_funnel_state (status);
create index if not exists idx_lead_funnel_state_phase on lead_funnel_state (phase, status);
create index if not exists idx_lead_funnel_state_slug on lead_funnel_state (slug);
```

- [ ] **Step 2: Apply in Supabase SQL editor**

Same dashboard URL, paste, run.

- [ ] **Step 3: Verify**

```sql
select column_name from information_schema.columns where table_name = 'lead_funnel_state';
```

Expected: 9 rows.

- [ ] **Step 4: Commit**

```bash
git add migrations/011_lead_funnel_state.sql
git commit -m "feat(db): migration 011 — lead_funnel_state with personalized_blob_url"
```

---

## Task 4: Define types

**Files:**
- Create: `crm/lib/funnel/types.ts`

- [ ] **Step 1: Write the file**

```typescript
// crm/lib/funnel/types.ts

export type Lead = {
  id: string;
  company_name: string;
  owner_name: string | null;
  city: string | null;
  state: string;
  phone: string;
  website: string | null;
  email: string;
  raw_site_text: string | null;
  review_samples: string[] | null;
  facebook_url: string | null;
  rating: number | null;
  review_count: number | null;
};

export type ResearchOutput = {
  best_review_quote: string | null;
  best_review_attribution: string | null;
  distinctive_services: string[];
  local_callout: string | null;
  tone_hint: "professional" | "folksy" | "urgent" | "established";
  visual_color_hint: string | null;
};

export type PersonalizationOutput = {
  hero_tagline: string;
  review_block_html: string;
  city_callout: string;
  color_overrides: { primary?: string; accent?: string } | null;
};

export type AuditResult = {
  approved: boolean;
  rejection_reason: string | null;
  fixed_personalization: PersonalizationOutput | null;
};

export type AgentTokenUsage = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

export type RunSummary = {
  run_date: string;
  leads_attempted: number;
  leads_sent: number;
  leads_failed: number;
  duration_ms: number;
  agent_token_usage: {
    research: AgentTokenUsage;
    personalize: AgentTokenUsage;
    audit: AgentTokenUsage;
  };
};

export type FunnelPhase = 1 | 2 | 3 | 4;
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd crm && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add crm/lib/funnel/types.ts
git commit -m "feat(funnel): define Lead, ResearchOutput, PersonalizationOutput, AuditResult types"
```

---

## Task 5: Anthropic client wrapper

**Files:**
- Create: `crm/lib/funnel/anthropic-client.ts`
- Create: `crm/lib/funnel/__tests__/anthropic-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/__tests__/anthropic-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { callWithRetry } from "../anthropic-client";

describe("callWithRetry", () => {
  it("returns result on success", async () => {
    const fn = vi.fn().mockResolvedValueOnce("ok");
    const result = await callWithRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and eventually succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce("ok");
    const result = await callWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after max retries on persistent 429", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 429 });
    await expect(callWithRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on non-429 errors", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(callWithRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/__tests__/anthropic-client.test.ts
```

Expected: FAIL — `callWithRetry` not exported.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/anthropic-client.ts
import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export type RetryOptions = { maxRetries?: number; baseDelayMs?: number };

export async function callWithRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429) throw err;
      if (attempt === maxRetries) break;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export const MODELS = {
  HAIKU: "claude-haiku-4-5-20251001",
  SONNET: "claude-sonnet-4-6",
  OPUS: "claude-opus-4-7",
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/__tests__/anthropic-client.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/anthropic-client.ts crm/lib/funnel/__tests__/anthropic-client.test.ts
git commit -m "feat(funnel): anthropic client with 429 backoff + model constants"
```

---

## Task 6: Research agent (Haiku)

**Files:**
- Create: `crm/lib/funnel/agents/research.ts`
- Create: `crm/lib/funnel/agents/__tests__/research.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/agents/__tests__/research.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead } from "../../types";

vi.mock("../../anthropic-client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  callWithRetry: <T>(fn: () => Promise<T>) => fn(),
  MODELS: { HAIKU: "claude-haiku-4-5-20251001" },
}));

import { research } from "../research";
import { anthropic } from "../../anthropic-client";

const fixtureLead: Lead = {
  id: "lead-1", company_name: "Acme Plumbing", owner_name: "John Doe",
  city: "Buffalo", state: "NY", phone: "(716) 555-0123",
  website: "https://acmeplumbing.com", email: "info@acmeplumbing.com",
  raw_site_text: "30 years in Elmwood. Emergency 24/7.",
  review_samples: ["Sarah K. — Acme came at 2am for our burst pipe."],
  facebook_url: null, rating: 4.8, review_count: 47,
};

describe("research agent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns parsed research output for a valid lead", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use", name: "submit_research",
        input: {
          best_review_quote: "Acme came at 2am for our burst pipe.",
          best_review_attribution: "Sarah K.",
          distinctive_services: ["emergency 24/7"],
          local_callout: "serving the Elmwood neighborhood",
          tone_hint: "established",
          visual_color_hint: null,
        },
      }],
      usage: { input_tokens: 1500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const r = await research(fixtureLead);
    expect(r.output.best_review_quote).toContain("burst pipe");
    expect(r.output.tone_hint).toBe("established");
    expect(r.usage.input).toBe(1500);
  });

  it("falls back to safe defaults when tool_use missing", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "text", text: "no extraction possible" }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const r = await research(fixtureLead);
    expect(r.output.best_review_quote).toBeNull();
    expect(r.output.distinctive_services).toEqual([]);
    expect(r.output.tone_hint).toBe("professional");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/agents/__tests__/research.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/agents/research.ts
import { anthropic, callWithRetry, MODELS } from "../anthropic-client";
import type { Lead, ResearchOutput, AgentTokenUsage } from "../types";

const SYSTEM_PROMPT = `You extract personalization hooks from small-business data so a downstream agent can write a landing page that feels hand-researched.

Rules:
- Only use facts present in the input. Do not invent reviews, services, or locations.
- Pick the SINGLE most compelling review quote (1-2 sentences max).
- "tone_hint" is one of: professional, folksy, urgent, established.
- If a field has no good data, return null (or empty array for services).
- Output ONLY via the submit_research tool.`;

const TOOL = {
  name: "submit_research",
  description: "Submit the structured research output.",
  input_schema: {
    type: "object" as const,
    properties: {
      best_review_quote: { type: ["string", "null"] },
      best_review_attribution: { type: ["string", "null"] },
      distinctive_services: { type: "array", items: { type: "string" } },
      local_callout: { type: ["string", "null"] },
      tone_hint: { type: "string", enum: ["professional", "folksy", "urgent", "established"] },
      visual_color_hint: { type: ["string", "null"] },
    },
    required: ["best_review_quote", "distinctive_services", "tone_hint"],
  },
};

const SAFE_DEFAULT: ResearchOutput = {
  best_review_quote: null, best_review_attribution: null,
  distinctive_services: [], local_callout: null,
  tone_hint: "professional", visual_color_hint: null,
};

export async function research(lead: Lead): Promise<{ output: ResearchOutput; usage: AgentTokenUsage }> {
  const userMessage = JSON.stringify({
    company_name: lead.company_name, owner_name: lead.owner_name,
    city: lead.city, state: lead.state, website: lead.website,
    raw_site_text: lead.raw_site_text?.slice(0, 4000) ?? null,
    review_samples: lead.review_samples ?? [],
    rating: lead.rating, review_count: lead.review_count,
  }, null, 2);

  const response = await callWithRetry(() =>
    anthropic.messages.create({
      model: MODELS.HAIKU, max_tokens: 800,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_research" },
      messages: [{ role: "user", content: userMessage }],
    })
  );

  const toolBlock = response.content.find((b) => b.type === "tool_use" && b.name === "submit_research");
  const output: ResearchOutput = toolBlock
    ? { ...SAFE_DEFAULT, ...(toolBlock.input as Partial<ResearchOutput>) }
    : SAFE_DEFAULT;

  return {
    output,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/agents/__tests__/research.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/agents/research.ts crm/lib/funnel/agents/__tests__/research.test.ts
git commit -m "feat(funnel): research agent (Haiku) with tool-use schema + safe defaults"
```

---

## Task 7: Personalizer agent (Opus)

**Files:**
- Create: `crm/lib/funnel/agents/personalizer.ts`
- Create: `crm/lib/funnel/agents/__tests__/personalizer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/agents/__tests__/personalizer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead, ResearchOutput } from "../../types";

vi.mock("../../anthropic-client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  callWithRetry: <T>(fn: () => Promise<T>) => fn(),
  MODELS: { OPUS: "claude-opus-4-7" },
}));

import { personalize } from "../personalizer";
import { anthropic } from "../../anthropic-client";

const lead: Lead = {
  id: "lead-1", company_name: "Acme Plumbing", owner_name: "John Doe",
  city: "Buffalo", state: "NY", phone: "(716) 555-0123",
  website: null, email: "x@y.com", raw_site_text: null, review_samples: null,
  facebook_url: null, rating: null, review_count: null,
};

const research: ResearchOutput = {
  best_review_quote: "Saved our basement at 2am.",
  best_review_attribution: "Sarah K.",
  distinctive_services: ["emergency 24/7"],
  local_callout: "Elmwood neighborhood",
  tone_hint: "established", visual_color_hint: null,
};

describe("personalizer agent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns personalization output", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{
        type: "tool_use", name: "submit_personalization",
        input: {
          hero_tagline: "Built for Acme Plumbing & their Buffalo customers",
          review_block_html: "<blockquote>Saved our basement at 2am.</blockquote>",
          city_callout: "homeowners in the Elmwood neighborhood",
          color_overrides: null,
        },
      }],
      usage: { input_tokens: 4500, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const r = await personalize(lead, research);
    expect(r.output.hero_tagline).toContain("Acme Plumbing");
    expect(r.output.review_block_html).toContain("blockquote");
  });

  it("throws when tool_use is absent", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "text", text: "no tool" }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    await expect(personalize(lead, research)).rejects.toThrow(/personalization/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/agents/__tests__/personalizer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/agents/personalizer.ts
import { anthropic, callWithRetry, MODELS } from "../anthropic-client";
import type { Lead, ResearchOutput, PersonalizationOutput, AgentTokenUsage } from "../types";

const SYSTEM_PROMPT = `You produce HTML diffs that personalize a landing page for a specific small plumbing business.

Rules:
- Use ONLY facts from the research input. Do not invent reviews, neighborhoods, or services.
- "hero_tagline" — under 12 words.
- "review_block_html" — valid HTML <blockquote> with attribution. Empty string if no review available.
- "city_callout" — single phrase referencing their location, used inline in body copy.
- "color_overrides" — null unless research provides a clear brand color hex.
- Tone-match: established=warm/trusted, urgent=direct/now, folksy=casual/local, professional=polished.
- DO NOT include <script>, <iframe>, or event handlers (onclick, onerror, etc.) in any HTML output. Plain text and basic formatting tags only (b, i, em, strong, blockquote, br, span, div, p).
- Submit ONLY via submit_personalization tool.`;

const TOOL = {
  name: "submit_personalization",
  description: "Submit the personalized HTML diffs.",
  input_schema: {
    type: "object" as const,
    properties: {
      hero_tagline: { type: "string" },
      review_block_html: { type: "string" },
      city_callout: { type: "string" },
      color_overrides: {
        type: ["object", "null"],
        properties: { primary: { type: "string" }, accent: { type: "string" } },
      },
    },
    required: ["hero_tagline", "review_block_html", "city_callout"],
  },
};

export async function personalize(lead: Lead, research: ResearchOutput): Promise<{ output: PersonalizationOutput; usage: AgentTokenUsage }> {
  const userMessage = JSON.stringify({
    lead: { company_name: lead.company_name, owner_name: lead.owner_name, city: lead.city, state: lead.state },
    research,
  }, null, 2);

  const response = await callWithRetry(() =>
    anthropic.messages.create({
      model: MODELS.OPUS, max_tokens: 1500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_personalization" },
      messages: [{ role: "user", content: userMessage }],
    })
  );

  const toolBlock = response.content.find((b) => b.type === "tool_use" && b.name === "submit_personalization");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Personalization agent did not return a tool_use block");
  }

  return {
    output: toolBlock.input as PersonalizationOutput,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/agents/__tests__/personalizer.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/agents/personalizer.ts crm/lib/funnel/agents/__tests__/personalizer.test.ts
git commit -m "feat(funnel): personalizer agent (Opus) with HTML safety constraints in system prompt"
```

---

## Task 8: Audit agent (Sonnet)

**Files:**
- Create: `crm/lib/funnel/agents/audit.ts`
- Create: `crm/lib/funnel/agents/__tests__/audit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/agents/__tests__/audit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResearchOutput, PersonalizationOutput } from "../../types";

vi.mock("../../anthropic-client", () => ({
  anthropic: { messages: { create: vi.fn() } },
  callWithRetry: <T>(fn: () => Promise<T>) => fn(),
  MODELS: { SONNET: "claude-sonnet-4-6" },
}));

import { audit } from "../audit";
import { anthropic } from "../../anthropic-client";

const research: ResearchOutput = {
  best_review_quote: "Saved our basement.", best_review_attribution: "Sarah K.",
  distinctive_services: ["emergency 24/7"], local_callout: "Elmwood neighborhood",
  tone_hint: "established", visual_color_hint: null,
};

const personalization: PersonalizationOutput = {
  hero_tagline: "Built for Acme",
  review_block_html: "<blockquote>Saved our basement. — Sarah K.</blockquote>",
  city_callout: "Elmwood", color_overrides: null,
};

describe("audit agent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves when personalization grounds in research", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "tool_use", name: "submit_audit", input: { approved: true, rejection_reason: null, fixed_personalization: null } }],
      usage: { input_tokens: 2500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const r = await audit(research, personalization);
    expect(r.output.approved).toBe(true);
  });

  it("rejects when personalization fabricates content", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "tool_use", name: "submit_audit", input: { approved: false, rejection_reason: "fabricated review attribution", fixed_personalization: null } }],
      usage: { input_tokens: 2500, output_tokens: 100 },
    });
    const r = await audit(research, personalization);
    expect(r.output.approved).toBe(false);
    expect(r.output.rejection_reason).toContain("fabricated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/agents/__tests__/audit.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/agents/audit.ts
import { anthropic, callWithRetry, MODELS } from "../anthropic-client";
import type { ResearchOutput, PersonalizationOutput, AuditResult, AgentTokenUsage } from "../types";

const SYSTEM_PROMPT = `You audit a personalization output against the research that produced it. Your only job: detect fabrication AND unsafe HTML.

Rules:
- Every quoted review must trace exactly to research.best_review_quote.
- Every location reference must trace to research.local_callout (or be a generic "your area").
- Every service mention must appear in research.distinctive_services.
- Reject any HTML containing <script>, <iframe>, <object>, <embed>, javascript: URLs, or event handlers (onclick, onerror, onload, etc.).
- If the issue is minor and fixable, set fixed_personalization to a corrected version. Otherwise leave it null.
- Submit ONLY via the submit_audit tool.`;

const TOOL = {
  name: "submit_audit",
  description: "Submit the audit decision.",
  input_schema: {
    type: "object" as const,
    properties: {
      approved: { type: "boolean" },
      rejection_reason: { type: ["string", "null"] },
      fixed_personalization: {
        type: ["object", "null"],
        properties: {
          hero_tagline: { type: "string" },
          review_block_html: { type: "string" },
          city_callout: { type: "string" },
          color_overrides: {
            type: ["object", "null"],
            properties: { primary: { type: "string" }, accent: { type: "string" } },
          },
        },
      },
    },
    required: ["approved"],
  },
};

export async function audit(research: ResearchOutput, personalization: PersonalizationOutput): Promise<{ output: AuditResult; usage: AgentTokenUsage }> {
  const userMessage = JSON.stringify({ research, personalization }, null, 2);

  const response = await callWithRetry(() =>
    anthropic.messages.create({
      model: MODELS.SONNET, max_tokens: 1000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_audit" },
      messages: [{ role: "user", content: userMessage }],
    })
  );

  const toolBlock = response.content.find((b) => b.type === "tool_use" && b.name === "submit_audit");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Audit agent did not return a tool_use block");
  }

  return {
    output: toolBlock.input as AuditResult,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cache_read: response.usage.cache_read_input_tokens ?? 0,
      cache_write: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/agents/__tests__/audit.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/agents/audit.ts crm/lib/funnel/agents/__tests__/audit.test.ts
git commit -m "feat(funnel): audit agent (Sonnet) — fabrication AND unsafe-HTML detection"
```

---

## Task 9: ~~Anchor comments~~ — DELETED

Originally proposed adding HTML comment anchors (`<!-- HERO_TAGLINE_START -->`) to the plumber template so the renderer could find injection points. **Rejected during plan revision** because Kurt re-exports the template from Claude Design every iteration cycle, which wipes the anchors. Task 10 was rewritten to use Cheerio's CSS selectors instead — robust to any number of re-exports.

(Skipped — proceed directly to Task 10.)

---

## Task 10: Renderer (Cheerio selector-based injection + upload to Blob)

**Files:**
- Create: `crm/lib/funnel/render.ts`
- Create: `crm/lib/funnel/__tests__/render.test.ts`

The renderer uses Cheerio (server-side jQuery) to find injection points by CSS selector, not HTML comments. This makes it robust to template re-exports — the selectors `h1`, `blockquote`, `:root` styles still match even when Kurt regenerates the HTML in Claude Design.

**Injection rules (per selector):**
- `h1` (first one) → replace text with `personalization.hero_tagline`
- `blockquote` (first one) → replace HTML content with `personalization.review_block_html`. If template has none, prepend a new one inside the first `section` containing the word "review" (case-insensitive); if still no match, prepend inside `body` after the first `h1`
- `:root --primary` style → replace value with `personalization.color_overrides.primary` if set
- `:root --accent` style → replace value with `personalization.color_overrides.accent` if set
- `city_callout` → first text node containing the placeholder word "local" inside a `<p>` gets the callout substituted in

The future merged template (when Kurt combines plumber + anchor offer in one Claude Design file) will work identically — Cheerio matches by structure, not anchors.

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/__tests__/render.test.ts
import { describe, it, expect, vi } from "vitest";
import type { PersonalizationOutput } from "../types";

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.vercel-storage.com/funnel/abc.html" }),
}));

import { applyDiffs, uploadPersonalizedHtml } from "../render";

const TEMPLATE = `
<html>
<head><style>:root { --primary: #000000; --accent: #ffffff; }</style></head>
<body>
<h1>Default plumber hero</h1>
<section class="reviews"><h2>Reviews</h2></section>
<p>Serving local homeowners for years.</p>
</body>
</html>
`.trim();

const PERSON: PersonalizationOutput = {
  hero_tagline: "Built for Acme Plumbing",
  review_block_html: "<blockquote>Saved our basement. — Sarah K.</blockquote>",
  city_callout: "homeowners in Elmwood",
  color_overrides: { primary: "#0b3a8f", accent: "#ffd700" },
};

describe("applyDiffs", () => {
  it("replaces the first h1 text with hero_tagline", () => {
    const out = applyDiffs(TEMPLATE, PERSON);
    expect(out).toContain("Built for Acme Plumbing");
    expect(out).not.toContain("Default plumber hero");
  });

  it("inserts review block inside the reviews section when no blockquote exists", () => {
    const out = applyDiffs(TEMPLATE, PERSON);
    expect(out).toMatch(/<section[^>]*class=["']reviews["'][^>]*>[\s\S]*?<blockquote>Saved our basement/);
  });

  it("replaces existing blockquote content when one is present", () => {
    const tmpl = TEMPLATE.replace(
      "<section class=\"reviews\"><h2>Reviews</h2></section>",
      "<section class=\"reviews\"><h2>Reviews</h2><blockquote>Old quote</blockquote></section>"
    );
    const out = applyDiffs(tmpl, PERSON);
    expect(out).toContain("Saved our basement");
    expect(out).not.toContain("Old quote");
  });

  it("substitutes city_callout for 'local' placeholder in body copy", () => {
    const out = applyDiffs(TEMPLATE, PERSON);
    expect(out).toContain("homeowners in Elmwood");
    expect(out).not.toMatch(/Serving local homeowners/);
  });

  it("inlines color override into :root CSS variables", () => {
    const out = applyDiffs(TEMPLATE, PERSON);
    expect(out).toContain("--primary: #0b3a8f");
    expect(out).toContain("--accent: #ffd700");
  });

  it("leaves color CSS unchanged when color_overrides is null", () => {
    const out = applyDiffs(TEMPLATE, { ...PERSON, color_overrides: null });
    expect(out).toContain("--primary: #000000");
    expect(out).toContain("--accent: #ffffff");
  });

  it("is idempotent — applying twice yields the same result", () => {
    const once = applyDiffs(TEMPLATE, PERSON);
    const twice = applyDiffs(once, PERSON);
    expect(twice).toBe(once);
  });
});

describe("uploadPersonalizedHtml", () => {
  it("uploads to Blob with stable funnel/{slug}.html path and returns URL", async () => {
    const { put } = await import("@vercel/blob");
    const url = await uploadPersonalizedHtml("acme-1", "<html></html>");
    expect(put).toHaveBeenCalledWith("funnel/acme-1.html", "<html></html>", expect.objectContaining({
      access: "public",
      contentType: "text/html",
      addRandomSuffix: false,
    }));
    expect(url).toMatch(/blob\.vercel-storage\.com/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/__tests__/render.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/render.ts
import { put } from "@vercel/blob";
import { readFileSync } from "fs";
import { join } from "path";
import * as cheerio from "cheerio";
import type { PersonalizationOutput } from "./types";

const TEMPLATE_PATH = join(process.cwd(), "public", "templates", "plumber-homepage.html");

let cachedTemplate: string | null = null;
export function getTemplate(): string {
  if (cachedTemplate === null) {
    cachedTemplate = readFileSync(TEMPLATE_PATH, "utf8");
  }
  return cachedTemplate;
}

function injectReviewBlock($: cheerio.CheerioAPI, html: string): void {
  const existing = $("blockquote").first();
  if (existing.length) {
    existing.replaceWith(html);
    return;
  }
  // No blockquote — find a "reviews" section
  const reviewSection = $("section").filter((_, el) => /review/i.test($(el).attr("class") ?? "")).first();
  if (reviewSection.length) {
    reviewSection.append(html);
    return;
  }
  // Last resort: prepend to body after the first h1
  const firstH1 = $("body h1").first();
  if (firstH1.length) {
    firstH1.after(html);
  } else {
    $("body").prepend(html);
  }
}

function substituteCityCallout($: cheerio.CheerioAPI, callout: string): void {
  // Find the first <p> whose text contains "local" (case-insensitive) and replace
  // that occurrence with the personalized callout.
  $("p").each((_, el) => {
    const $el = $(el);
    const text = $el.text();
    if (/\blocal\b/i.test(text)) {
      $el.text(text.replace(/\blocal\b/i, callout.replace(/^homeowners in /i, ""))
        .replace(callout.replace(/^homeowners in /i, ""), callout));
      return false; // break
    }
  });
}

function applyColorOverrides(html: string, overrides: PersonalizationOutput["color_overrides"]): string {
  if (!overrides) return html;
  let out = html;
  if (overrides.primary) {
    out = out.replace(/(--primary\s*:\s*)[^;]+(;)/g, `$1${overrides.primary}$2`);
  }
  if (overrides.accent) {
    out = out.replace(/(--accent\s*:\s*)[^;]+(;)/g, `$1${overrides.accent}$2`);
  }
  return out;
}

export function applyDiffs(template: string, p: PersonalizationOutput): string {
  const $ = cheerio.load(template, { xml: false });

  // Hero tagline → first h1
  const h1 = $("h1").first();
  if (h1.length) h1.text(p.hero_tagline);

  // Review block → first blockquote OR section.reviews
  if (p.review_block_html) {
    injectReviewBlock($, p.review_block_html);
  }

  // City callout → first <p> containing "local"
  if (p.city_callout) {
    substituteCityCallout($, p.city_callout);
  }

  // Color overrides operate on raw HTML (CSS rules in <style>) outside Cheerio
  let out = $.html();
  out = applyColorOverrides(out, p.color_overrides);

  return out;
}

export async function uploadPersonalizedHtml(slug: string, html: string): Promise<string> {
  const result = await put(`funnel/${slug}.html`, html, {
    access: "public",
    contentType: "text/html",
    addRandomSuffix: false,
  });
  return result.url;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/__tests__/render.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/render.ts crm/lib/funnel/__tests__/render.test.ts
git commit -m "feat(funnel): renderer uses cheerio CSS selectors (robust to template re-exports)"
```

---

## Task 11: Smartlead REST client

**Files:**
- Create: `crm/lib/funnel/smartlead.ts`
- Create: `crm/lib/funnel/__tests__/smartlead.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/__tests__/smartlead.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushLeads, type SmartleadLead } from "../smartlead";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.SMARTLEAD_API_KEY = "sl-test";
  process.env.SMARTLEAD_CAMPAIGN_ID = "12345";
});

afterEach(() => fetchMock.mockReset());

const lead: SmartleadLead = {
  email: "owner@acme.com", first_name: "John", last_name: "Doe",
  company_name: "Acme Plumbing",
  custom_fields: { landing_url: "https://example.com/l/acme-1" },
};

describe("pushLeads", () => {
  it("posts leads to the configured campaign", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ uploaded: 1 }) });
    const r = await pushLeads([lead]);
    expect(r.uploaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/campaigns/12345/leads?api_key=sl-test"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("retries on 429 with backoff and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ uploaded: 1 }) });
    const r = await pushLeads([lead], { baseDelayMs: 1 });
    expect(r.uploaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on non-429 error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "server" }) });
    await expect(pushLeads([lead])).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/__tests__/smartlead.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/smartlead.ts
const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

export type SmartleadLead = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_fields?: Record<string, string>;
};

export type PushOptions = { maxRetries?: number; baseDelayMs?: number };
export type PushResult = { uploaded: number; failed: number };

export async function pushLeads(leads: SmartleadLead[], opts: PushOptions = {}): Promise<PushResult> {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const campaignId = process.env.SMARTLEAD_CAMPAIGN_ID;
  if (!apiKey || !campaignId) {
    throw new Error("SMARTLEAD_API_KEY and SMARTLEAD_CAMPAIGN_ID must be set");
  }

  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const url = `${SMARTLEAD_BASE}/campaigns/${campaignId}/leads?api_key=${apiKey}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_list: leads }),
    });

    if (res.ok) {
      const data = (await res.json()) as { uploaded?: number; failed?: number };
      return { uploaded: data.uploaded ?? leads.length, failed: data.failed ?? 0 };
    }

    if (res.status === 429 && attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const body = await res.json().catch(() => ({}));
    throw new Error(`Smartlead push failed: ${res.status} ${JSON.stringify(body)}`);
  }

  throw new Error("Smartlead push exhausted retries");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/__tests__/smartlead.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/smartlead.ts crm/lib/funnel/__tests__/smartlead.test.ts
git commit -m "feat(funnel): smartlead REST client with exponential backoff on 429"
```

---

## Task 12: Lead selector

**Files:**
- Create: `crm/lib/funnel/lead-selector.ts`
- Create: `crm/lib/funnel/__tests__/lead-selector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/__tests__/lead-selector.test.ts
import { describe, it, expect } from "vitest";
import { computePhase, slugify } from "../lead-selector";

describe("computePhase", () => {
  it("returns 1 with both owner_name and review_samples", () => {
    expect(computePhase({ owner_name: "John", review_samples: ["x"] })).toBe(1);
  });
  it("returns 2 with only owner_name", () => {
    expect(computePhase({ owner_name: "John", review_samples: null })).toBe(2);
    expect(computePhase({ owner_name: "John", review_samples: [] })).toBe(2);
  });
  it("returns 3 with only review_samples", () => {
    expect(computePhase({ owner_name: null, review_samples: ["x"] })).toBe(3);
  });
  it("returns 4 with neither", () => {
    expect(computePhase({ owner_name: null, review_samples: null })).toBe(4);
  });
});

describe("slugify", () => {
  it("produces a stable url-safe slug from company_name + lead_id", () => {
    const slug = slugify("Acme Plumbing & Heating, LLC", "abc12345-6789");
    expect(slug).toMatch(/^acme-plumbing-heating-llc-[a-f0-9]{6}$/);
  });
  it("trims to a reasonable length", () => {
    const long = "A".repeat(200);
    const slug = slugify(long, "abc12345");
    expect(slug.length).toBeLessThanOrEqual(70);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/__tests__/lead-selector.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/lead-selector.ts
import { createClient } from "@supabase/supabase-js";
import type { Lead, FunnelPhase } from "./types";

const STATE_ORDER = ["NY", "PA", "NJ", "CT", "MA"];

export function computePhase(input: { owner_name: string | null; review_samples: string[] | null }): FunnelPhase {
  const hasOwner = !!input.owner_name;
  const hasReviews = !!(input.review_samples && input.review_samples.length > 0);
  if (hasOwner && hasReviews) return 1;
  if (hasOwner && !hasReviews) return 2;
  if (!hasOwner && hasReviews) return 3;
  return 4;
}

export function slugify(companyName: string, leadId: string): string {
  const base = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const suffix = leadId.replace(/-/g, "").slice(0, 6);
  return `${base}-${suffix}`;
}

export async function selectNextBatch(limit: number): Promise<Lead[]> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const candidatePool = limit * 4;
  const { data, error } = await supabase
    .from("leads")
    .select(`
      id, company_name, city, state, phone, email, website,
      lead_enrichment ( owner_name, raw_site_text, review_samples, facebook_url, rating, review_count )
    `)
    .eq("status", "enriched")
    .not("email", "is", null)
    .limit(candidatePool);

  if (error) throw error;

  const ids = (data ?? []).map((l: { id: string }) => l.id);
  const { data: states } = await supabase
    .from("lead_funnel_state")
    .select("lead_id, status")
    .in("lead_id", ids);

  const settled = new Set(
    (states ?? []).filter((s) => s.status !== "pending").map((s) => s.lead_id)
  );

  type RawRow = { id: string; company_name: string; city: string | null; state: string; phone: string; email: string; website: string | null; lead_enrichment: { owner_name: string | null; raw_site_text: string | null; review_samples: string[] | null; facebook_url: string | null; rating: number | null; review_count: number | null } | null };

  const flattened = (data as RawRow[] ?? [])
    .filter((l) => !settled.has(l.id))
    .map((l) => {
      const e = l.lead_enrichment ?? { owner_name: null, raw_site_text: null, review_samples: null, facebook_url: null, rating: null, review_count: null };
      const lead: Lead = {
        id: l.id, company_name: l.company_name, owner_name: e.owner_name,
        city: l.city, state: l.state, phone: l.phone, email: l.email, website: l.website,
        raw_site_text: e.raw_site_text, review_samples: e.review_samples,
        facebook_url: e.facebook_url, rating: e.rating, review_count: e.review_count,
      };
      return { lead, phase: computePhase(lead) };
    })
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      const ai = STATE_ORDER.indexOf(a.lead.state);
      const bi = STATE_ORDER.indexOf(b.lead.state);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .slice(0, limit)
    .map((x) => x.lead);

  return flattened;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/__tests__/lead-selector.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/lead-selector.ts crm/lib/funnel/__tests__/lead-selector.test.ts
git commit -m "feat(funnel): lead selector — phase computation, slug, Supabase batch query"
```

---

## Task 13: Supabase funnel state writer

**Files:**
- Create: `crm/lib/funnel/supabase-funnel.ts`

- [ ] **Step 1: Implement**

```typescript
// crm/lib/funnel/supabase-funnel.ts
import { createClient } from "@supabase/supabase-js";
import type { FunnelPhase, RunSummary } from "./types";

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function startRun(runDate: string): Promise<{ id: string }> {
  const sb = getClient();
  const { data, error } = await sb
    .from("funnel_runs")
    .insert({ run_date: runDate, status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

export async function completeRun(id: string, summary: RunSummary): Promise<void> {
  const sb = getClient();
  await sb.from("funnel_runs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    leads_attempted: summary.leads_attempted,
    leads_sent: summary.leads_sent,
    leads_failed: summary.leads_failed,
    agent_token_usage: summary.agent_token_usage,
  }).eq("id", id);
}

export async function failRun(id: string, errorSummary: string): Promise<void> {
  const sb = getClient();
  await sb.from("funnel_runs").update({
    status: "failed",
    completed_at: new Date().toISOString(),
    error_summary: errorSummary,
  }).eq("id", id);
}

export type LeadStateUpdate = {
  lead_id: string;
  slug: string;
  phase: FunnelPhase;
  status: "personalized" | "sent";
  personalized_blob_url?: string;
  smartlead_lead_id?: string;
};

export async function upsertLeadState(args: LeadStateUpdate): Promise<void> {
  const sb = getClient();
  const update: Record<string, unknown> = {
    lead_id: args.lead_id,
    slug: args.slug,
    phase: args.phase,
    status: args.status,
    last_event_at: new Date().toISOString(),
  };
  if (args.status === "personalized") update.personalized_at = new Date().toISOString();
  if (args.status === "sent") update.pushed_to_smartlead_at = new Date().toISOString();
  if (args.personalized_blob_url) update.personalized_blob_url = args.personalized_blob_url;
  if (args.smartlead_lead_id) update.smartlead_lead_id = args.smartlead_lead_id;
  await sb.from("lead_funnel_state").upsert(update, { onConflict: "lead_id" });
}

export async function getLeadStateBySlug(slug: string): Promise<{ personalized_blob_url: string | null } | null> {
  const sb = getClient();
  const { data } = await sb
    .from("lead_funnel_state")
    .select("personalized_blob_url")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd crm && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add crm/lib/funnel/supabase-funnel.ts
git commit -m "feat(funnel): Supabase wrappers for funnel_runs and lead_funnel_state with blob URL lookup"
```

---

## Task 14: Twilio alert helper

**Files:**
- Create: `crm/lib/funnel/twilio-alert.ts`

- [ ] **Step 1: Implement**

```typescript
// crm/lib/funnel/twilio-alert.ts
import twilio from "twilio";

export async function sendFailureAlert(message: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.TWILIO_ALERT_TO_NUMBER;
  if (!sid || !token || !from || !to) {
    console.warn("Twilio env vars missing — skipping SMS alert");
    return;
  }
  const client = twilio(sid, token);
  await client.messages.create({ body: `[Anchor Funnel] ${message}`, from, to });
}
```

- [ ] **Step 2: Commit**

```bash
git add crm/lib/funnel/twilio-alert.ts
git commit -m "feat(funnel): Twilio SMS alert helper for run failures"
```

---

## Task 15: Orchestrator

**Files:**
- Create: `crm/lib/funnel/orchestrator.ts`
- Create: `crm/lib/funnel/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// crm/lib/funnel/__tests__/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead, ResearchOutput, PersonalizationOutput, AuditResult } from "../types";

const lead = (id: string, overrides: Partial<Lead> = {}): Lead => ({
  id, company_name: `Co ${id}`, owner_name: "John", city: "Buffalo", state: "NY",
  phone: "555-0000", website: null, email: `x@${id}.com`,
  raw_site_text: "...", review_samples: ["good"],
  facebook_url: null, rating: 4.5, review_count: 20, ...overrides,
});

const r: ResearchOutput = { best_review_quote: "good", best_review_attribution: "S",
  distinctive_services: [], local_callout: null, tone_hint: "professional", visual_color_hint: null };
const p: PersonalizationOutput = { hero_tagline: "h", review_block_html: "<blockquote>good</blockquote>", city_callout: "c", color_overrides: null };
const auditOK: AuditResult = { approved: true, rejection_reason: null, fixed_personalization: null };
const usage = { input: 10, output: 5, cache_read: 0, cache_write: 0 };

vi.mock("../agents/research", () => ({ research: vi.fn(async () => ({ output: r, usage })) }));
vi.mock("../agents/personalizer", () => ({ personalize: vi.fn(async () => ({ output: p, usage })) }));
vi.mock("../agents/audit", () => ({ audit: vi.fn(async () => ({ output: auditOK, usage })) }));
vi.mock("../render", () => ({
  getTemplate: () => "<html><!-- HERO_TAGLINE_START -->h<!-- HERO_TAGLINE_END --></html>",
  applyDiffs: vi.fn(() => "<html>personalized</html>"),
  uploadPersonalizedHtml: vi.fn(async (slug: string) => `https://blob.example/${slug}.html`),
}));
vi.mock("../smartlead", () => ({
  pushLeads: vi.fn(async (leads: unknown[]) => ({ uploaded: leads.length, failed: 0 })),
}));
vi.mock("../supabase-funnel", () => ({ upsertLeadState: vi.fn(async () => {}) }));

import { runFunnelBatch } from "../orchestrator";

describe("runFunnelBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("processes leads end-to-end and returns aggregated summary", async () => {
    const leads = [lead("a"), lead("b"), lead("c")];
    const result = await runFunnelBatch(leads, { runDate: "2026-04-27", concurrency: 2 });
    expect(result.leads_attempted).toBe(3);
    expect(result.leads_sent).toBe(3);
    expect(result.leads_failed).toBe(0);
  });

  it("counts as failed when audit rejects without fix", async () => {
    const { audit } = await import("../agents/audit");
    (audit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      output: { approved: false, rejection_reason: "fabricated", fixed_personalization: null },
      usage,
    });
    const leads = [lead("a"), lead("b")];
    const result = await runFunnelBatch(leads, { runDate: "2026-04-27", concurrency: 2 });
    expect(result.leads_sent).toBe(1);
    expect(result.leads_failed).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm && npx vitest run lib/funnel/__tests__/orchestrator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// crm/lib/funnel/orchestrator.ts
import pLimit from "p-limit";
import { research } from "./agents/research";
import { personalize } from "./agents/personalizer";
import { audit } from "./agents/audit";
import { getTemplate, applyDiffs, uploadPersonalizedHtml } from "./render";
import { pushLeads, type SmartleadLead } from "./smartlead";
import { upsertLeadState } from "./supabase-funnel";
import { computePhase, slugify } from "./lead-selector";
import type { Lead, RunSummary, AgentTokenUsage } from "./types";

type RunOptions = { runDate: string; concurrency?: number };

const ZERO_USAGE: AgentTokenUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

function addUsage(a: AgentTokenUsage, b: AgentTokenUsage): AgentTokenUsage {
  return {
    input: a.input + b.input, output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read, cache_write: a.cache_write + b.cache_write,
  };
}

export async function runFunnelBatch(leads: Lead[], opts: RunOptions): Promise<RunSummary> {
  const startedAt = Date.now();
  const concurrency = opts.concurrency ?? 5;
  const limit = pLimit(concurrency);

  const totals = { research: { ...ZERO_USAGE }, personalize: { ...ZERO_USAGE }, audit: { ...ZERO_USAGE } };
  let sent = 0;
  let failed = 0;
  const ready: Array<{ lead: Lead; slug: string; smartleadLead: SmartleadLead }> = [];

  await Promise.all(
    leads.map((lead) =>
      limit(async () => {
        try {
          const rRes = await research(lead);
          totals.research = addUsage(totals.research, rRes.usage);

          const pRes = await personalize(lead, rRes.output);
          totals.personalize = addUsage(totals.personalize, pRes.usage);

          const aRes = await audit(rRes.output, pRes.output);
          totals.audit = addUsage(totals.audit, aRes.usage);

          if (!aRes.output.approved && !aRes.output.fixed_personalization) {
            failed++;
            return;
          }
          const finalP = aRes.output.fixed_personalization ?? pRes.output;

          const slug = slugify(lead.company_name, lead.id);
          const html = applyDiffs(getTemplate(), finalP);
          const blobUrl = await uploadPersonalizedHtml(slug, html);

          const phase = computePhase({ owner_name: lead.owner_name, review_samples: lead.review_samples });
          await upsertLeadState({
            lead_id: lead.id, slug, phase, status: "personalized",
            personalized_blob_url: blobUrl,
          });

          const ownerParts = (lead.owner_name ?? "").split(" ");
          const landingHost = process.env.VERCEL_URL ?? "anchor-leads.vercel.app";
          ready.push({
            lead, slug,
            smartleadLead: {
              email: lead.email,
              first_name: ownerParts[0] || "",
              last_name: ownerParts.slice(1).join(" ") || "",
              company_name: lead.company_name,
              custom_fields: { landing_url: `https://${landingHost}/l/${slug}` },
            },
          });
        } catch {
          failed++;
        }
      })
    )
  );

  if (ready.length > 0) {
    const result = await pushLeads(ready.map((r) => r.smartleadLead));
    sent = result.uploaded;
    failed += result.failed;

    await Promise.all(
      ready.map((r) => upsertLeadState({
        lead_id: r.lead.id, slug: r.slug,
        phase: computePhase({ owner_name: r.lead.owner_name, review_samples: r.lead.review_samples }),
        status: "sent",
      }))
    );
  }

  return {
    run_date: opts.runDate,
    leads_attempted: leads.length,
    leads_sent: sent,
    leads_failed: failed,
    duration_ms: Date.now() - startedAt,
    agent_token_usage: totals,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm && npx vitest run lib/funnel/__tests__/orchestrator.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crm/lib/funnel/orchestrator.ts crm/lib/funnel/__tests__/orchestrator.test.ts
git commit -m "feat(funnel): orchestrator with concurrency-limited fan-out + audit gating"
```

---

## Task 16: Cron endpoint

**Files:**
- Create: `crm/app/api/cron/funnel/route.ts`

- [ ] **Step 1: Implement**

```typescript
// crm/app/api/cron/funnel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runFunnelBatch } from "@/lib/funnel/orchestrator";
import { selectNextBatch } from "@/lib/funnel/lead-selector";
import { startRun, completeRun, failRun } from "@/lib/funnel/supabase-funnel";
import { sendFailureAlert } from "@/lib/funnel/twilio-alert";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const runDate = new Date().toISOString().slice(0, 10);
  let runId: string | null = null;

  try {
    const { id } = await startRun(runDate);
    runId = id;

    const limit = Number(process.env.MAX_DAILY_SENDS ?? 75);
    const leads = await selectNextBatch(limit);

    const summary = await runFunnelBatch(leads, { runDate, concurrency: 5 });
    await completeRun(runId, summary);

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) await failRun(runId, msg);
    await sendFailureAlert(`Funnel run ${runDate} failed: ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd crm && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add crm/app/api/cron/funnel/route.ts
git commit -m "feat(funnel): cron endpoint with CRON_SECRET auth + idempotency lock"
```

---

## Task 17: Smartlead webhook handler

**Files:**
- Create: `crm/app/api/webhooks/smartlead/route.ts`

- [ ] **Step 1: Implement**

```typescript
// crm/app/api/webhooks/smartlead/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type WebhookEvent = {
  event_type: "EMAIL_REPLY" | "EMAIL_BOUNCE" | "LEAD_UNSUBSCRIBED" | string;
  lead_email: string;
  campaign_id?: number;
};

const STATUS_BY_EVENT: Record<string, string> = {
  EMAIL_REPLY: "replied",
  EMAIL_BOUNCE: "bounced",
  LEAD_UNSUBSCRIBED: "unsubscribed",
};

export async function POST(req: NextRequest) {
  const expected = process.env.SMARTLEAD_WEBHOOK_SECRET;
  const provided = req.nextUrl.searchParams.get("secret");
  if (expected && provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const event = (await req.json()) as WebhookEvent;
  const newStatus = STATUS_BY_EVENT[event.event_type];
  if (!newStatus) return NextResponse.json({ ok: true, ignored: true });

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: lead } = await sb.from("leads").select("id").eq("email", event.lead_email).maybeSingle();
  if (!lead) return NextResponse.json({ ok: true, lead_not_found: true });

  await sb
    .from("lead_funnel_state")
    .update({ status: newStatus, last_event_at: new Date().toISOString() })
    .eq("lead_id", lead.id);

  return NextResponse.json({ ok: true, lead_id: lead.id, status: newStatus });
}
```

- [ ] **Step 2: Commit**

```bash
git add crm/app/api/webhooks/smartlead/route.ts
git commit -m "feat(funnel): smartlead webhook handler — reply/bounce/unsubscribe state updates"
```

---

## Task 18: Update /l/[slug] route to iframe the personalized Blob URL

**Files:**
- Modify: `crm/app/l/[slug]/page.tsx`

This task replaces dangerous HTML injection with a sandboxed iframe pointing at the Blob URL stored in `lead_funnel_state`. **No `dangerouslySetInnerHTML` anywhere.** Sandbox attribute strips script execution, form submission, top-level navigation — defense in depth even though the audit agent should have rejected unsafe HTML upstream.

- [ ] **Step 1: Replace the existing page**

```tsx
// crm/app/l/[slug]/page.tsx
import { notFound } from "next/navigation";
import { getLeadStateBySlug } from "@/lib/funnel/supabase-funnel";
import leadsJson from "./leads.json";

type Lead = { company_name: string; owner_name: string; city: string; state: string; phone: string };
const demoLeads = leadsJson as Record<string, Lead>;

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Real lead path: lookup the personalized HTML URL in Supabase, iframe it.
  const state = await getLeadStateBySlug(slug);
  if (state?.personalized_blob_url) {
    return (
      <main style={{ margin: 0, padding: 0, background: "#0a1628" }}>
        <iframe
          src={state.personalized_blob_url}
          title="Personalized landing page"
          sandbox="allow-same-origin allow-popups"
          style={{ display: "block", width: "100%", height: "100vh", border: 0 }}
        />
        <iframe
          src="/templates/anchor-offer.html"
          title="The Anchor Zero Plan"
          sandbox="allow-same-origin allow-popups allow-forms"
          style={{ display: "block", width: "100%", height: "100vh", border: 0 }}
        />
      </main>
    );
  }

  // Demo path (no DB row): render demo banner + template iframes
  if (demoLeads[slug]) {
    const lead = demoLeads[slug];
    return (
      <main style={{ margin: 0, padding: 0, background: "#0a1628", color: "#fff", fontFamily: "-apple-system,sans-serif" }}>
        <div style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "#2db4ff", fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Demo / Fallback</p>
          <h1 style={{ margin: "4px 0", fontSize: 36 }}>{lead.owner_name} at {lead.company_name}</h1>
          <p style={{ color: "#cfe8ff", margin: 0 }}>{lead.city}, {lead.state} · {lead.phone}</p>
        </div>
        <iframe src="/templates/plumber-homepage.html" sandbox="allow-same-origin allow-popups" style={{ display: "block", width: "100%", height: "100vh", border: 0 }} />
        <iframe src="/templates/anchor-offer.html" sandbox="allow-same-origin allow-popups allow-forms" style={{ display: "block", width: "100%", height: "100vh", border: 0 }} />
      </main>
    );
  }

  notFound();
}
```

- [ ] **Step 2: Verify TypeScript + dev render**

```bash
cd crm && npx tsc --noEmit
# Then in another terminal, dev server should already be running on :3010
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3010/l/demo-acme-plumbing
```

Expected: tsc clean, curl returns 200 (demo path still works).

- [ ] **Step 3: Commit**

```bash
git add crm/app/l/[slug]/page.tsx
git commit -m "feat(funnel): /l/[slug] serves Blob URL via sandboxed iframe (no dangerouslySetInnerHTML)"
```

---

## Task 19: Vercel cron config

**Files:**
- Create: `crm/vercel.ts`

- [ ] **Step 1: Write the config**

```typescript
// crm/vercel.ts
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    { path: "/api/cron/funnel", schedule: "0 11 * * *" }, // 6 AM ET = 11:00 UTC
  ],
};
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd crm && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add crm/vercel.ts
git commit -m "feat(funnel): vercel.ts cron config — daily run at 6 AM ET"
```

---

## Task 20: Configure Vercel env vars

**Files:**
- (none — manual setup via Vercel CLI)

- [ ] **Step 1: Set secrets in Vercel production env**

```bash
cd crm
vercel env add ANTHROPIC_API_KEY production
vercel env add SMARTLEAD_API_KEY production
vercel env add SMARTLEAD_CAMPAIGN_ID production
vercel env add SMARTLEAD_WEBHOOK_SECRET production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add BLOB_READ_WRITE_TOKEN production
vercel env add TWILIO_ACCOUNT_SID production
vercel env add TWILIO_AUTH_TOKEN production
vercel env add TWILIO_FROM_NUMBER production
vercel env add TWILIO_ALERT_TO_NUMBER production
vercel env add MAX_DAILY_SENDS production   # value: 75
vercel env add MIN_REPLY_RATE_PCT production # value: 1.5
```

CRON_SECRET is auto-managed by Vercel for cron jobs and injected on deployment — does not need manual `env add`.

- [ ] **Step 2: Verify each is set**

```bash
vercel env ls production
```

Expected: all 13 vars present + auto-injected CRON_SECRET visible.

- [ ] **Step 3: Pull to local**

```bash
vercel env pull .env.local
```

This writes a `.env.local` in `crm/` for local dev + integration tests.

---

## Task 21: Deploy + end-to-end smoke test

**Files:**
- Create: `docs/funnel-runbook.md` (in step 7)

- [ ] **Step 1: Deploy preview**

```bash
cd crm && vercel deploy
```

Capture the preview URL.

- [ ] **Step 2: Smoke-test the cron endpoint with auth**

```bash
PREVIEW_URL="<paste from step 1>"
SECRET="<copy from Vercel dashboard → Settings → Crons>"
curl -s -H "Authorization: Bearer $SECRET" "$PREVIEW_URL/api/cron/funnel" | jq
```

Expected: JSON `{ ok: true, leads_attempted: 0, ... }` (no leads ready yet). Confirms auth + idempotency work.

Then test bare endpoint without auth:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$PREVIEW_URL/api/cron/funnel"
```

Expected: 401.

- [ ] **Step 3: Insert 3 demo leads into Supabase**

In SQL editor:

```sql
with new_leads as (
  insert into leads (id, company_name, city, state, phone, email, status, source)
  values
    (gen_random_uuid(), 'Acme Plumbing', 'Buffalo', 'NY', '(716) 555-0123', 'demo+acme@example.com', 'enriched', 'demo'),
    (gen_random_uuid(), 'Redline Plumbing', 'Syracuse', 'NY', '(315) 555-0199', 'demo+redline@example.com', 'enriched', 'demo'),
    (gen_random_uuid(), 'Tradesmen P&H', 'Rochester', 'NY', '(585) 555-0144', 'demo+tradesmen@example.com', 'enriched', 'demo')
  returning id, company_name
)
insert into lead_enrichment (lead_id, owner_name, review_samples, raw_site_text)
select
  id,
  case company_name
    when 'Acme Plumbing' then 'John Doe'
    when 'Redline Plumbing' then 'Mike Russo'
    else 'Sam Hill'
  end,
  case company_name
    when 'Acme Plumbing' then '["Sarah K. — Acme came at 2am for a burst pipe. Saved our basement."]'::jsonb
    when 'Redline Plumbing' then '["Tom L. — Mike fixed our boiler same-day, fair price."]'::jsonb
    else '["Jane M. — Tradesmen handled our renovation start to finish."]'::jsonb
  end,
  case company_name
    when 'Acme Plumbing' then 'We serve the Elmwood neighborhood. 24/7 emergency.'
    when 'Redline Plumbing' then 'Family-owned since 1985. Boiler specialists.'
    else 'Full bathroom and kitchen plumbing.'
  end
from new_leads;
```

- [ ] **Step 4: Trigger cron with MAX_DAILY_SENDS temporarily set to 3**

```bash
vercel env rm MAX_DAILY_SENDS production
vercel env add MAX_DAILY_SENDS production # value: 3
vercel deploy --prod
PROD_URL=$(vercel ls --prod | head -1)
curl -s -H "Authorization: Bearer $SECRET" "$PROD_URL/api/cron/funnel" | jq
```

Expected: `{ ok: true, leads_attempted: 3, leads_sent: 3, leads_failed: 0, agent_token_usage: {...} }`.

- [ ] **Step 5: Verify each demo lead's landing page**

In Supabase SQL editor:

```sql
select slug, personalized_blob_url from lead_funnel_state where status = 'sent';
```

Open each `$PROD_URL/l/<slug>` in a browser. Expected:
- Top iframe shows the plumber-homepage with hero personalized to the company
- A blockquote with the actual review text from the demo data
- City callout references the actual city
- Bottom iframe shows the anchor offer
- No console errors

- [ ] **Step 6: Verify Smartlead received them**

```bash
smartlead leads list --campaign-id $SMARTLEAD_CAMPAIGN_ID --status pending --limit 10 --format json | jq '.[] | { email, custom_fields }'
```

Expected: 3 leads with `landing_url` custom field populated.

- [ ] **Step 7: Reset MAX_DAILY_SENDS to warmup target and write runbook**

```bash
vercel env rm MAX_DAILY_SENDS production
vercel env add MAX_DAILY_SENDS production # value: 25 (warmup) — bump to 75 after 2 weeks
vercel deploy --prod

cat > docs/funnel-runbook.md <<'EOF'
# Cold Email Funnel — Operations Runbook

## Daily run
- Cron fires at 6 AM ET via Vercel
- Logs: vercel.com/<team>/<project>/logs (filter by /api/cron/funnel)
- Run records: select * from funnel_runs order by run_date desc limit 7;

## Pause sending
- Vercel dashboard → Settings → Crons → toggle off, OR
- vercel env rm MAX_DAILY_SENDS && vercel env add MAX_DAILY_SENDS production # value: 0

## Manual trigger
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/funnel

## Troubleshooting
- Hallucinated personalization → check funnel_runs.error_summary; re-deploy with stricter audit prompt
- Smartlead 429 → backoff is automatic; check stats with `smartlead stats top-level --from <date> --to <date>`
- Supabase egress → monitor in Supabase dashboard usage panel

## Manual resume after auto-pause
insert into funnel_runs (run_date, status) values (current_date, 'resumed_manually');
EOF

git add docs/funnel-runbook.md
git commit -m "docs(funnel): operations runbook — daily run, pause, troubleshoot"
```

---

## Self-Review

**1. Spec coverage:**
- §3 Architecture → Tasks 5-21 all map
- §4.1 Cron handler → Task 16
- §4.2 Orchestrator → Task 15
- §4.3 Research / §4.4 Personalize / §4.5 Audit → Tasks 6 / 7 / 8
- §4.6 Renderer → Task 10
- §4.7 Landing page route → Task 18
- §4.8 Smartlead push → Task 11
- §4.9 Tables → Tasks 2, 3
- §4.10 Webhook → Task 17
- §5 Phase ordering → Task 12
- §6 Security → Tasks 16 (auth), 17 (webhook secret), 20 (env vars), 18 (sandboxed iframe), 7+8 (HTML safety in prompts)
- §7 Testing → every TDD task + Task 21 smoke test

**2. Placeholders:** None remaining. Every code step has actual code, every command has expected output.

**3. Type consistency:** `Lead`, `ResearchOutput`, `PersonalizationOutput`, `AuditResult`, `AgentTokenUsage`, `RunSummary`, `FunnelPhase` defined once in Task 4, used identically through Task 15. `slugify` and `computePhase` defined in Task 12, called by Task 15. `pushLeads` signature stable across Tasks 11 → 15. `MODELS.HAIKU/SONNET/OPUS` from Task 5 used in 6/7/8. `upsertLeadState` signature consistent between Task 13 and Task 15. `getLeadStateBySlug` from Task 13 used in Task 18.

**4. Security delta from blocked plan:** Original Task 18 used `dangerouslySetInnerHTML` to inject Blob HTML into the React tree — XSS surface even with audit. Replaced with sandboxed iframe pointing at the Blob URL stored in Supabase. Audit prompt in Task 8 now explicitly rejects `<script>`, `<iframe>`, event handlers, javascript: URLs in the personalization output as a second wall.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-27-cold-email-funnel-plan.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
