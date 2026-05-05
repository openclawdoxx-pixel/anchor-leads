import { createClient } from "@supabase/supabase-js";
import leadsJson from "./leads.json";
import type { PersonalizationOutput } from "@/lib/funnel/types";

export type LeadView = {
  company_name: string;
  owner_name?: string | null;
  city?: string | null;
  state: string;
  phone: string;
};

export type Lookup = {
  lead: LeadView;
  personalization: PersonalizationOutput | null;
};

const demoLeads = leadsJson as Record<string, LeadView>;

export async function lookupLead(slug: string): Promise<Lookup | null> {
  if (demoLeads[slug]) return { lead: demoLeads[slug], personalization: null };

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)");
  const sb = createClient(url, key);
  const { data: state } = await sb
    .from("lead_funnel_state")
    .select("lead_id, personalization")
    .eq("slug", slug)
    .maybeSingle();
  if (!state) return null;

  const { data: lead } = await sb
    .from("leads_final")
    .select("company_name, owner_name, city, state, phone")
    .eq("id", state.lead_id)
    .maybeSingle();
  if (!lead) return null;

  // personalization is jsonb; default '{}' means "not yet personalized" — return null
  const raw = state.personalization;
  const hasContent = raw && typeof raw === "object" && Object.keys(raw).length > 0;
  const personalization = hasContent ? (raw.personalization as PersonalizationOutput) : null;

  return { lead, personalization };
}
