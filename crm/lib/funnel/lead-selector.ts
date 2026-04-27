// crm/lib/funnel/lead-selector.ts
import { createClient } from "@supabase/supabase-js";
import type { Lead, FunnelPhase } from "./types";

const STATE_ORDER = ["NY", "PA", "NJ", "CT", "MA"];

export function computePhase(input: {
  owner_name: string | null;
  review_samples: string[] | null;
}): FunnelPhase {
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
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const candidatePool = limit * 4;
  const { data, error } = await supabase
    .from("leads")
    .select(
      `
      id, company_name, city, state, phone, email, website,
      lead_enrichment ( owner_name, raw_site_text, review_samples, facebook_url, rating, review_count )
    `
    )
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

  type RawRow = {
    id: string;
    company_name: string;
    city: string | null;
    state: string;
    phone: string;
    email: string;
    website: string | null;
    lead_enrichment:
      | {
          owner_name: string | null;
          raw_site_text: string | null;
          review_samples: string[] | null;
          facebook_url: string | null;
          rating: number | null;
          review_count: number | null;
        }
      | Array<{
          owner_name: string | null;
          raw_site_text: string | null;
          review_samples: string[] | null;
          facebook_url: string | null;
          rating: number | null;
          review_count: number | null;
        }>
      | null;
  };

  const flattened = ((data as unknown as RawRow[]) ?? [])
    .filter((l) => !settled.has(l.id))
    .map((l) => {
      const enrichmentRaw = l.lead_enrichment;
      const e =
        (Array.isArray(enrichmentRaw) ? enrichmentRaw[0] : enrichmentRaw) ?? {
          owner_name: null,
          raw_site_text: null,
          review_samples: null,
          facebook_url: null,
          rating: null,
          review_count: null,
        };
      const lead: Lead = {
        id: l.id,
        company_name: l.company_name,
        owner_name: e.owner_name,
        city: l.city,
        state: l.state,
        phone: l.phone,
        email: l.email,
        website: l.website,
        raw_site_text: e.raw_site_text,
        review_samples: e.review_samples,
        facebook_url: e.facebook_url,
        rating: e.rating,
        review_count: e.review_count,
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
