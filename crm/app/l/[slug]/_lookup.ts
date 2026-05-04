import { createClient } from "@supabase/supabase-js";
import leadsJson from "./leads.json";

export type LeadView = {
  company_name: string;
  owner_name?: string | null;
  city?: string | null;
  state: string;
  phone: string;
};

const demoLeads = leadsJson as Record<string, LeadView>;

export async function lookupLead(slug: string): Promise<LeadView | null> {
  if (demoLeads[slug]) return demoLeads[slug];

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)");
  const sb = createClient(url, key);
  const { data: state } = await sb
    .from("lead_funnel_state")
    .select("lead_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!state) return null;

  const { data: lead } = await sb
    .from("leads_final")
    .select("company_name, owner_name, city, state, phone")
    .eq("id", state.lead_id)
    .maybeSingle();
  return lead ?? null;
}
