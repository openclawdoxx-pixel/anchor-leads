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
