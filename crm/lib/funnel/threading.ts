// crm/lib/funnel/threading.ts
//
// Threading orchestrator. Day 3 (Email 2) and Day 21 (Email 6) replies are
// NOT Smartlead sequence steps — Smartlead would send them as new threads.
// We send them via `sendInboxReply` so they thread under Email 1 / Email 5
// in the recipient's inbox.
//
// Three responsibilities:
//   1. Webhook ingestion — record state from Smartlead's EMAIL_* events
//   2. Reply runner — find leads at Day 3 / Day 21 milestones and send
//   3. Path A/B selection — based on click history captured via webhook

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { THREADED_REPLIES, SMARTLEAD_CAMPAIGNS } from "./config";
import {
  sendInboxReply,
  getMessageHistory,
  type MessageHistoryItem,
} from "./smartlead";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FunnelStateRow = {
  lead_id: string;
  slug: string;
  smartlead_lead_id: string | null;
  campaign_id: number | null;
  email_stats_ids: Record<string, string>;
  clicked_email_steps: number[];
  pushed_to_smartlead_at: string | null;
  email_2_reply_sent_at: string | null;
  email_6_reply_sent_at: string | null;
  terminal_event: "replied" | "bounced" | "unsubscribed" | null;
};

export type ThreadingRunResult = {
  email_2_attempted: number;
  email_2_sent: number;
  email_2_skipped: number;
  email_2_failed: number;
  email_6_attempted: number;
  email_6_sent: number;
  email_6_skipped: number;
  email_6_failed: number;
};

export type ThreadingRunOptions = {
  /** Wall clock for "now" — pass a fixed value in tests. Defaults to Date.now(). */
  now?: Date;
  /** Cap replies sent per run. Default 10 (matches hourly cron @ ~100/day max). */
  maxRepliesPerRun?: number;
  /** Override the supabase client (tests). */
  supabase?: SupabaseClient;
};

// Smartlead sequence_number → meaning in our funnel.
const SEQ_EMAIL_1 = 1; // Day 0 send. Email 2 (Day 3) threads under this.
const SEQ_EMAIL_5 = 4; // 4th sequence step (Day 18). Email 6 (Day 21) threads under this.

const DAY = 86_400_000;

// ─── Supabase helpers ───────────────────────────────────────────────────────

function getSupabase(override?: SupabaseClient): SupabaseClient {
  if (override) return override;
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function findLeadIdByEmail(
  sb: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("leads")
    .select("id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[threading] findLeadIdByEmail error for ${email}:`, error.message);
    return null;
  }
  return data?.id ?? null;
}

// ─── Webhook ingestion ──────────────────────────────────────────────────────
//
// Each function is idempotent: replaying the same webhook produces the same
// final state. Smartlead has at-least-once delivery, so duplicates happen.

export async function recordEmailSent(args: {
  email: string;
  smartleadLeadId: number | string;
  campaignId: number;
  sequenceNumber: number;
  emailStatsId?: string;
  supabase?: SupabaseClient;
}): Promise<void> {
  const sb = getSupabase(args.supabase);
  const leadId = await findLeadIdByEmail(sb, args.email);
  if (!leadId) {
    console.warn(`[threading] EMAIL_SENT for unknown email ${args.email} — skipping`);
    return;
  }
  // Read-modify-write the jsonb map. Postgres jsonb concat would be cleaner
  // but supabase-js doesn't expose it directly, so do it client-side.
  const { data: existing } = await sb
    .from("lead_funnel_state")
    .select("email_stats_ids, smartlead_lead_id, campaign_id")
    .eq("lead_id", leadId)
    .maybeSingle();
  const merged: Record<string, string> = { ...(existing?.email_stats_ids ?? {}) };
  if (args.emailStatsId) {
    merged[String(args.sequenceNumber)] = args.emailStatsId;
  }
  await sb
    .from("lead_funnel_state")
    .update({
      smartlead_lead_id: existing?.smartlead_lead_id ?? String(args.smartleadLeadId),
      campaign_id: existing?.campaign_id ?? args.campaignId,
      email_stats_ids: merged,
      last_event_at: new Date().toISOString(),
    })
    .eq("lead_id", leadId);
}

export async function recordEmailClicked(args: {
  email: string;
  sequenceNumber: number;
  supabase?: SupabaseClient;
}): Promise<void> {
  const sb = getSupabase(args.supabase);
  const leadId = await findLeadIdByEmail(sb, args.email);
  if (!leadId) return;
  const { data: existing } = await sb
    .from("lead_funnel_state")
    .select("clicked_email_steps")
    .eq("lead_id", leadId)
    .maybeSingle();
  const steps = new Set([...(existing?.clicked_email_steps ?? []), args.sequenceNumber]);
  await sb
    .from("lead_funnel_state")
    .update({
      clicked_email_steps: Array.from(steps).sort(),
      last_event_at: new Date().toISOString(),
    })
    .eq("lead_id", leadId);
}

export async function recordTerminalEvent(args: {
  email: string;
  kind: "replied" | "bounced" | "unsubscribed";
  supabase?: SupabaseClient;
}): Promise<void> {
  const sb = getSupabase(args.supabase);
  const leadId = await findLeadIdByEmail(sb, args.email);
  if (!leadId) return;
  // Only set if currently null — first terminal event wins.
  await sb
    .from("lead_funnel_state")
    .update({
      terminal_event: args.kind,
      terminal_event_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    })
    .eq("lead_id", leadId)
    .is("terminal_event", null);
}

// ─── Reply runner ───────────────────────────────────────────────────────────

export async function runThreadingBatch(
  opts: ThreadingRunOptions = {},
): Promise<ThreadingRunResult> {
  const sb = getSupabase(opts.supabase);
  const now = opts.now ?? new Date();
  const cap = opts.maxRepliesPerRun ?? 10;

  // Day 3 cutoff: lead's pushed_to_smartlead_at is at least 3 days ago AND
  // EMAIL_SENT for sequence 1 has fired (we have email_stats_ids["1"] OR
  // we can fall back to message-history).
  const cutoff3 = new Date(now.getTime() - 3 * DAY).toISOString();
  // Day 21: same idea, but using sequence 4 (Email 5) as the anchor for Email 6.
  // Email 5 fires at Day 18, Email 6 is 3 days later = Day 21 from Email 1.
  // For the partial-index scan we still use pushed_to_smartlead_at >= 21 days,
  // which is conservative — Smartlead may delay sends, but the runner re-checks
  // email_stats_ids["4"] before sending and skips if the anchor isn't there yet.
  const cutoff21 = new Date(now.getTime() - 21 * DAY).toISOString();

  const result: ThreadingRunResult = {
    email_2_attempted: 0, email_2_sent: 0, email_2_skipped: 0, email_2_failed: 0,
    email_6_attempted: 0, email_6_sent: 0, email_6_skipped: 0, email_6_failed: 0,
  };

  // ── Day 3 batch (Email 2) ────────────────────────────────────────────────
  const day3Cap = Math.min(cap, 10);
  const { data: day3Leads, error: day3Err } = await sb
    .from("lead_funnel_state")
    .select(
      "lead_id, slug, smartlead_lead_id, campaign_id, email_stats_ids, clicked_email_steps, pushed_to_smartlead_at, email_2_reply_sent_at, email_6_reply_sent_at, terminal_event",
    )
    .eq("status", "sent")
    .is("email_2_reply_sent_at", null)
    .is("terminal_event", null)
    .lte("pushed_to_smartlead_at", cutoff3)
    .order("pushed_to_smartlead_at", { ascending: true })
    .limit(day3Cap);
  if (day3Err) throw day3Err;

  for (const row of (day3Leads ?? []) as FunnelStateRow[]) {
    result.email_2_attempted++;
    try {
      const ok = await sendThreadedReply({
        sb,
        row,
        anchorSeq: SEQ_EMAIL_1,
        bodyChooser: (clicked) =>
          clicked.includes(SEQ_EMAIL_1)
            ? THREADED_REPLIES.email_2_path_b.body
            : THREADED_REPLIES.email_2_path_a.body,
        timestampColumn: "email_2_reply_sent_at",
      });
      if (ok === "sent") result.email_2_sent++;
      else if (ok === "skipped") result.email_2_skipped++;
      else result.email_2_failed++;
    } catch (err) {
      console.error(`[threading] Day 3 reply failed for ${row.lead_id}:`, errMsg(err));
      result.email_2_failed++;
    }
  }

  // ── Day 21 batch (Email 6) ───────────────────────────────────────────────
  const remaining = Math.max(0, cap - result.email_2_sent - result.email_2_failed);
  if (remaining > 0) {
    const { data: day21Leads, error: day21Err } = await sb
      .from("lead_funnel_state")
      .select(
        "lead_id, slug, smartlead_lead_id, campaign_id, email_stats_ids, clicked_email_steps, pushed_to_smartlead_at, email_2_reply_sent_at, email_6_reply_sent_at, terminal_event",
      )
      .eq("status", "sent")
      .is("email_6_reply_sent_at", null)
      .is("terminal_event", null)
      .lte("pushed_to_smartlead_at", cutoff21)
      .order("pushed_to_smartlead_at", { ascending: true })
      .limit(remaining);
    if (day21Err) throw day21Err;

    for (const row of (day21Leads ?? []) as FunnelStateRow[]) {
      result.email_6_attempted++;
      try {
        const ok = await sendThreadedReply({
          sb,
          row,
          anchorSeq: SEQ_EMAIL_5,
          bodyChooser: () => THREADED_REPLIES.email_6.body,
          timestampColumn: "email_6_reply_sent_at",
        });
        if (ok === "sent") result.email_6_sent++;
        else if (ok === "skipped") result.email_6_skipped++;
        else result.email_6_failed++;
      } catch (err) {
        console.error(`[threading] Day 21 reply failed for ${row.lead_id}:`, errMsg(err));
        result.email_6_failed++;
      }
    }
  }

  return result;
}

// ─── Inner helpers ──────────────────────────────────────────────────────────

type SendOutcome = "sent" | "skipped" | "failed";

async function sendThreadedReply(args: {
  sb: SupabaseClient;
  row: FunnelStateRow;
  anchorSeq: number;
  bodyChooser: (clicked: number[]) => string;
  timestampColumn: "email_2_reply_sent_at" | "email_6_reply_sent_at";
}): Promise<SendOutcome> {
  const { sb, row, anchorSeq, bodyChooser, timestampColumn } = args;

  if (row.campaign_id == null) {
    console.warn(`[threading] lead ${row.lead_id} has no campaign_id — skipping`);
    return "skipped";
  }

  // Resolve email_stats_id for the anchor step. Prefer cached value from
  // EMAIL_SENT webhook; fall back to message-history lookup if missing.
  let statsId: string | undefined = row.email_stats_ids?.[String(anchorSeq)];
  if (!statsId) {
    if (row.smartlead_lead_id == null) {
      console.warn(
        `[threading] lead ${row.lead_id} missing both email_stats_ids[${anchorSeq}] and smartlead_lead_id — skipping until webhook fills it in`,
      );
      return "skipped";
    }
    const history = await getMessageHistory({
      campaignId: row.campaign_id,
      leadId: Number(row.smartlead_lead_id),
    });
    const found = pickStatsIdForSeq(history, anchorSeq);
    if (!found) {
      console.warn(
        `[threading] lead ${row.lead_id} message-history has no entry for seq=${anchorSeq} — anchor email may not have actually sent yet`,
      );
      return "skipped";
    }
    statsId = found;
    // Cache it so we don't re-fetch on the next run.
    const updatedMap = { ...row.email_stats_ids, [String(anchorSeq)]: statsId };
    await sb
      .from("lead_funnel_state")
      .update({ email_stats_ids: updatedMap })
      .eq("lead_id", row.lead_id);
  }

  const body = renderMergeFields(
    bodyChooser(row.clicked_email_steps ?? []),
    await loadMergeContext(sb, row),
  );

  await sendInboxReply({
    campaignId: row.campaign_id,
    emailStatsId: statsId,
    body,
  });

  // Stamp the timestamp ONLY on success, with a guard that still requires the
  // column to be null — protects against double-fire if two runs overlap.
  const { data: updated, error: updErr } = await sb
    .from("lead_funnel_state")
    .update({
      [timestampColumn]: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    })
    .eq("lead_id", row.lead_id)
    .is(timestampColumn, null)
    .select("lead_id");
  if (updErr) throw updErr;
  if (!updated || updated.length === 0) {
    // Another run already stamped it — we sent twice. Log loudly so we can
    // tighten the cron lock if it happens often.
    console.error(
      `[threading] DOUBLE-SEND DETECTED on lead ${row.lead_id} (${timestampColumn}) — tighten cron lock`,
    );
  }
  return "sent";
}

function pickStatsIdForSeq(history: MessageHistoryItem[], seq: number): string | undefined {
  // Smartlead history is usually ordered oldest-first, but we don't trust it.
  // Find the first entry matching the sequence number.
  for (const h of history) {
    if (h.sequence_number === seq && h.email_stats_id) return h.email_stats_id;
  }
  return undefined;
}

async function loadMergeContext(
  sb: SupabaseClient,
  row: FunnelStateRow,
): Promise<{ company_name: string; landing_url: string }> {
  const { data } = await sb
    .from("leads")
    .select("company_name")
    .eq("id", row.lead_id)
    .maybeSingle();
  const host =
    process.env.LANDING_BASE_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? "anchor-leads.vercel.app";
  return {
    company_name: data?.company_name ?? "",
    landing_url: `https://${host}/l/${row.slug}`,
  };
}

const MERGE_RE = /\{\{\s*(?:custom_fields\.)?(\w+)\s*\}\}/g;

function renderMergeFields(
  body: string,
  ctx: Record<string, string>,
): string {
  return body.replace(MERGE_RE, (_, key) => {
    const val = ctx[key];
    return typeof val === "string" ? val : "";
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Re-exports for the cron / webhook handlers ─────────────────────────────

export { SMARTLEAD_CAMPAIGNS };
