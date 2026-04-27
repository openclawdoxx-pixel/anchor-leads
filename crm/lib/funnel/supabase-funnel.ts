// crm/lib/funnel/supabase-funnel.ts
import { createClient } from "@supabase/supabase-js";
import type { FunnelPhase, RunSummary } from "./types";

function getClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function startRun(runDate: string): Promise<{ id: string }> {
  const sb = getClient();
  const { data, error } = await sb
    .from("funnel_runs")
    .insert({ run_date: runDate, status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

export async function completeRun(id: string, summary: RunSummary): Promise<void> {
  const sb = getClient();
  await sb.from("funnel_runs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    leads_attempted: summary.leads_attempted,
    leads_sent: summary.leads_sent,
    leads_failed: summary.leads_failed,
    agent_token_usage: summary.agent_token_usage,
  }).eq("id", id);
}

export async function failRun(id: string, errorSummary: string): Promise<void> {
  const sb = getClient();
  await sb.from("funnel_runs").update({
    status: "failed",
    completed_at: new Date().toISOString(),
    error_summary: errorSummary,
  }).eq("id", id);
}

export type LeadStateUpdate = {
  lead_id: string;
  slug: string;
  phase: FunnelPhase;
  status: "personalized" | "sent";
  personalized_blob_url?: string;
  smartlead_lead_id?: string;
};

export async function upsertLeadState(args: LeadStateUpdate): Promise<void> {
  const sb = getClient();
  const update: Record<string, unknown> = {
    lead_id: args.lead_id,
    slug: args.slug,
    phase: args.phase,
    status: args.status,
    last_event_at: new Date().toISOString(),
  };
  if (args.status === "personalized") update.personalized_at = new Date().toISOString();
  if (args.status === "sent") update.pushed_to_smartlead_at = new Date().toISOString();
  if (args.personalized_blob_url) update.personalized_blob_url = args.personalized_blob_url;
  if (args.smartlead_lead_id) update.smartlead_lead_id = args.smartlead_lead_id;
  await sb.from("lead_funnel_state").upsert(update, { onConflict: "lead_id" });
}

export async function getLeadStateBySlug(slug: string): Promise<{ personalized_blob_url: string | null } | null> {
  const sb = getClient();
  const { data } = await sb
    .from("lead_funnel_state")
    .select("personalized_blob_url")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}
