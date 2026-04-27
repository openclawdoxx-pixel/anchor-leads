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
