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
  best_review_quote: "Saved our basement.",
  best_review_attribution: "Sarah K.",
  distinctive_services: ["emergency 24/7"],
  local_callout: "Elmwood neighborhood",
  tone_hint: "established",
  visual_color_hint: null,
};

const personalization: PersonalizationOutput = {
  hero_tagline: "Built for Acme",
  review_block_html: "<blockquote>Saved our basement. — Sarah K.</blockquote>",
  city_callout: "Elmwood",
  color_overrides: null,
};

describe("audit agent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves when personalization grounds in research", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          name: "submit_audit",
          input: { approved: true, rejection_reason: null, fixed_personalization: null },
        },
      ],
      usage: {
        input_tokens: 2500,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    const r = await audit(research, personalization);
    expect(r.output.approved).toBe(true);
  });

  it("rejects when personalization fabricates content", async () => {
    (anthropic.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          name: "submit_audit",
          input: {
            approved: false,
            rejection_reason: "fabricated review attribution",
            fixed_personalization: null,
          },
        },
      ],
      usage: { input_tokens: 2500, output_tokens: 100 },
    });
    const r = await audit(research, personalization);
    expect(r.output.approved).toBe(false);
    expect(r.output.rejection_reason).toContain("fabricated");
  });
});
