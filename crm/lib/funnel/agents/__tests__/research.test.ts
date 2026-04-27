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
