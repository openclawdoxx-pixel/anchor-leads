import pLimit from "p-limit";
import { research } from "./agents/research";
import { personalize } from "./agents/personalizer";
import { audit } from "./agents/audit";
import { getTemplate, applyDiffs, uploadPersonalizedHtml } from "./render";
import { pushLeads, type SmartleadLead } from "./smartlead";
import { upsertLeadState } from "./supabase-funnel";
import { computePhase, slugify } from "./lead-selector";
import type { Lead, RunSummary, AgentTokenUsage, PersonalizationOutput } from "./types";

type RunOptions = { runDate: string; concurrency?: number };

const ZERO_USAGE: AgentTokenUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

function addUsage(a: AgentTokenUsage, b: AgentTokenUsage): AgentTokenUsage {
  return {
    input: a.input + b.input, output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read, cache_write: a.cache_write + b.cache_write,
  };
}

export async function runFunnelBatch(leads: Lead[], opts: RunOptions): Promise<RunSummary> {
  const startedAt = Date.now();
  const concurrency = opts.concurrency ?? 5;
  const limit = pLimit(concurrency);

  const totals = { research: { ...ZERO_USAGE }, personalize: { ...ZERO_USAGE }, audit: { ...ZERO_USAGE } };
  let failed = 0;
  const ready: Array<{ lead: Lead; slug: string; smartleadLead: SmartleadLead; phase: 1 | 2 | 3 | 4 }> = [];

  const SAFE_FALLBACK: PersonalizationOutput = {
    hero_tagline: "Your website. Built in 24 hours. $0 upfront.",
    review_block_html: "",
    city_callout: "your community",
    color_overrides: null,
  };

  await Promise.all(
    leads.map((lead) =>
      limit(async () => {
        try {
          const rRes = await research(lead);
          totals.research = addUsage(totals.research, rRes.usage);

          const pRes = await personalize(lead, rRes.output);
          totals.personalize = addUsage(totals.personalize, pRes.usage);

          const aRes = await audit(rRes.output, pRes.output);
          totals.audit = addUsage(totals.audit, aRes.usage);

          // Spec §4.5: audit reject without fix → use safe template, log warning
          let finalP: PersonalizationOutput;
          if (aRes.output.approved) {
            finalP = pRes.output;
          } else if (aRes.output.fixed_personalization && isValidPersonalization(aRes.output.fixed_personalization)) {
            finalP = aRes.output.fixed_personalization;
          } else {
            console.warn(`[funnel] audit rejected lead ${lead.id} (${lead.company_name}): ${aRes.output.rejection_reason ?? "no reason"} — using safe fallback`);
            finalP = SAFE_FALLBACK;
          }

          const slug = slugify(lead.company_name, lead.id);
          const html = applyDiffs(getTemplate(), finalP);
          const blobUrl = await uploadPersonalizedHtml(slug, html);

          const phase = computePhase({ owner_name: lead.owner_name, review_samples: lead.review_samples });
          await upsertLeadState({
            lead_id: lead.id, slug, phase, status: "personalized",
            personalized_blob_url: blobUrl,
          });

          const ownerParts = (lead.owner_name ?? "").split(" ");
          const landingHost = process.env.LANDING_BASE_URL
            ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
            ?? "anchor-leads.vercel.app";
          ready.push({
            lead, slug, phase,
            smartleadLead: {
              email: lead.email,
              first_name: ownerParts[0] || "",
              last_name: ownerParts.slice(1).join(" ") || "",
              company_name: lead.company_name,
              custom_fields: { landing_url: `https://${landingHost}/l/${slug}` },
            },
          });
        } catch (err) {
          console.error(`[funnel] lead ${lead.id} (${lead.company_name}) pre-push failure:`, err instanceof Error ? err.message : String(err));
          failed++;
        }
      })
    )
  );

  // Per-lead push: each Smartlead chunk reports aggregate; we treat "all in chunk uploaded"
  // as success for those leads. If chunk reports any failures, we mark the count but not which
  // — Smartlead doesn't return per-lead IDs in v1 bulk push. To attribute precisely we'd need
  // single-lead pushes (slower). For now: if uploaded < submitted, ONLY mark the first
  // `uploaded` as sent (best-effort), the rest stay as personalized (will retry tomorrow).
  let sent = 0;
  if (ready.length > 0) {
    try {
      const result = await pushLeads(ready.map((r) => r.smartleadLead));
      sent = result.uploaded;
      const sentCount = Math.min(result.uploaded, ready.length);
      // Mark only the leads we believe were uploaded as 'sent'.
      for (let i = 0; i < sentCount; i++) {
        const r = ready[i];
        await upsertLeadState({ lead_id: r.lead.id, slug: r.slug, phase: r.phase, status: "sent" });
      }
      // Remaining `ready` leads stay 'personalized' so the selector picks them up next run.
      failed += result.failed;
    } catch (err) {
      console.error(`[funnel] smartlead push failed for ${ready.length} leads:`, err instanceof Error ? err.message : String(err));
      failed += ready.length;
    }
  }

  return {
    run_date: opts.runDate,
    leads_attempted: leads.length,
    leads_sent: sent,
    leads_failed: failed,
    duration_ms: Date.now() - startedAt,
    agent_token_usage: totals,
  };
}

function isValidPersonalization(p: unknown): p is PersonalizationOutput {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.hero_tagline === "string"
    && typeof o.review_block_html === "string"
    && typeof o.city_callout === "string";
}
