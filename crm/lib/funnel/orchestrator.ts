import pLimit from "p-limit";
import { research } from "./agents/research";
import { personalize } from "./agents/personalizer";
import { audit } from "./agents/audit";
import { getTemplate, applyDiffs, uploadPersonalizedHtml } from "./render";
import { pushLeads, type SmartleadLead } from "./smartlead";
import { upsertLeadState } from "./supabase-funnel";
import { computePhase, slugify } from "./lead-selector";
import type { Lead, RunSummary, AgentTokenUsage } from "./types";

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
  let sent = 0;
  let failed = 0;
  const ready: Array<{ lead: Lead; slug: string; smartleadLead: SmartleadLead }> = [];

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

          if (!aRes.output.approved && !aRes.output.fixed_personalization) {
            failed++;
            return;
          }
          const finalP = aRes.output.fixed_personalization ?? pRes.output;

          const slug = slugify(lead.company_name, lead.id);
          const html = applyDiffs(getTemplate(), finalP);
          const blobUrl = await uploadPersonalizedHtml(slug, html);

          const phase = computePhase({ owner_name: lead.owner_name, review_samples: lead.review_samples });
          await upsertLeadState({
            lead_id: lead.id, slug, phase, status: "personalized",
            personalized_blob_url: blobUrl,
          });

          const ownerParts = (lead.owner_name ?? "").split(" ");
          const landingHost = process.env.VERCEL_URL ?? "anchor-leads.vercel.app";
          ready.push({
            lead, slug,
            smartleadLead: {
              email: lead.email,
              first_name: ownerParts[0] || "",
              last_name: ownerParts.slice(1).join(" ") || "",
              company_name: lead.company_name,
              custom_fields: { landing_url: `https://${landingHost}/l/${slug}` },
            },
          });
        } catch {
          failed++;
        }
      })
    )
  );

  if (ready.length > 0) {
    const result = await pushLeads(ready.map((r) => r.smartleadLead));
    sent = result.uploaded;
    failed += result.failed;

    await Promise.all(
      ready.map((r) => upsertLeadState({
        lead_id: r.lead.id, slug: r.slug,
        phase: computePhase({ owner_name: r.lead.owner_name, review_samples: r.lead.review_samples }),
        status: "sent",
      }))
    );
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
