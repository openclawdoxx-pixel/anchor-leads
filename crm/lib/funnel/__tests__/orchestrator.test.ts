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
  getTemplate: () => "<html><h1>h</h1></html>",
  applyDiffs: vi.fn(() => "<html>personalized</html>"),
  uploadPersonalizedHtml: vi.fn(async (slug: string) => `https://blob.example/${slug}.html`),
}));
vi.mock("../smartlead", () => ({
  pushLeads: vi.fn(async (leads: unknown[]) => ({ uploaded: leads.length, failed: 0 })),
  sendInboxReply: vi.fn(async () => undefined),
  getMessageHistory: vi.fn(async () => []),
  listCampaignMailboxes: vi.fn(async () => []),
  countWarmedMailboxes: vi.fn(() => 0),
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

  it("uses safe fallback when audit rejects without fix (still sent)", async () => {
    const { audit } = await import("../agents/audit");
    (audit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      output: { approved: false, rejection_reason: "fabricated", fixed_personalization: null },
      usage,
    });
    const leads = [lead("a"), lead("b")];
    const result = await runFunnelBatch(leads, { runDate: "2026-04-27", concurrency: 2 });
    expect(result.leads_sent).toBe(2); // both succeed — one via fallback
    expect(result.leads_failed).toBe(0);
  });

  it("routes leads to no_site or has_site campaign based on lead.website", async () => {
    const { pushLeads } = await import("../smartlead");
    const noSite = lead("a", { website: null });
    const hasSite = lead("b", { website: "https://acme.com" });
    await runFunnelBatch([noSite, hasSite], { runDate: "2026-04-27", concurrency: 2 });

    const calls = (pushLeads as ReturnType<typeof vi.fn>).mock.calls;
    // Two pushLeads calls — one per group.
    expect(calls.length).toBe(2);
    const seenCampaignIds = calls.map((c) => (c[1] as { campaignId: number }).campaignId).sort();
    expect(seenCampaignIds).toEqual([3224195, 3238040]);
  });

  it("stamps campaign_id at personalize time so threading uses the right campaign", async () => {
    const { upsertLeadState } = await import("../supabase-funnel");
    await runFunnelBatch([lead("a", { website: null })], { runDate: "2026-04-27", concurrency: 1 });
    const personalizeCall = (upsertLeadState as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => (c[0] as { status: string }).status === "personalized");
    expect(personalizeCall).toBeDefined();
    expect((personalizeCall![0] as { campaign_id: number }).campaign_id).toBe(3224195);
  });
});
