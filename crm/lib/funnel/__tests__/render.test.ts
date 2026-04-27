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

  it("strips <script> and event-handler attributes from review_block_html", () => {
    const evil: PersonalizationOutput = {
      ...PERSON,
      review_block_html: `<blockquote>Saved our basement.<script>alert(1)</script><img src=x onerror=alert(1)></blockquote>`,
    };
    const out = applyDiffs(TEMPLATE, evil);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("onerror");
    expect(out).toContain("Saved our basement");
  });

  it("rejects non-hex color overrides", () => {
    const out = applyDiffs(TEMPLATE, { ...PERSON, color_overrides: { primary: "red; }/* injected */" } });
    expect(out).toContain("--primary: #000000"); // unchanged
    expect(out).not.toContain("injected");
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
