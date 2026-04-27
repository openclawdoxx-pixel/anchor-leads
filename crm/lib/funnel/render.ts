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
  // Find first <p> whose text contains "local" (whole-word, case-insensitive) and
  // replace that single occurrence inside the paragraph with the personalized callout.
  $("p").each((_, el) => {
    const $el = $(el);
    const text = $el.text();
    if (/\blocal\b/i.test(text)) {
      // The callout already typically reads "homeowners in <city>", so we replace
      // "local homeowners" → callout, OR "local <word>" → callout when "homeowners"
      // not present. Simplest robust rule: collapse "local <next-word>" into callout.
      const collapsed = text.replace(/\blocal\s+\w+/i, callout);
      $el.text(collapsed === text ? text.replace(/\blocal\b/i, callout) : collapsed);
      return false; // break out of .each
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

  const h1 = $("h1").first();
  if (h1.length) h1.text(p.hero_tagline);

  if (p.review_block_html) {
    injectReviewBlock($, p.review_block_html);
  }

  if (p.city_callout) {
    substituteCityCallout($, p.city_callout);
  }

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
