// crm/lib/funnel/capacity.ts
//
// Dynamic intake cap for the funnel. The math:
//
//   max_intake_today = floor( (warmed_mailboxes × 25 × 0.8) / 6 )
//
// Where:
//   - 25 = conservative per-mailbox daily send cap (vs 40 Smartlead default)
//   - 0.8 = 20% headroom buffer
//   - 6 = total emails per lead across the full sequence (4 Smartlead steps
//         + 2 threaded replies). At steady state, every NEW lead intake today
//         generates 6 sends spread over the next 21 days.
//
// We cap at funnelConfig.max_daily_sends as a hard ceiling, and subtract
// anything already pushed earlier today so multiple cron runs on the same
// day don't double-spend.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  listCampaignMailboxes,
  countWarmedMailboxes,
  type SmartleadMailbox,
} from "./smartlead";
import { SMARTLEAD_CAMPAIGNS } from "./config";
import { funnelConfig } from "./config";

const PER_MAILBOX_DAILY_CAP = 25;
const HEADROOM = 0.8;
const SENDS_PER_LEAD = 6;

export type CapacityBreakdown = {
  warmed_mailboxes: number;
  raw_capacity: number;
  config_ceiling: number;
  pushed_today: number;
  remaining_intake: number;
};

export async function computeDailyIntakeCap(opts: {
  /** UTC day window for "today". Defaults to UTC midnight for now(). */
  now?: Date;
  /** Override mailbox listing (tests). */
  mailboxes?: SmartleadMailbox[];
  /** Override Supabase client (tests). */
  supabase?: SupabaseClient;
} = {}): Promise<CapacityBreakdown> {
  const now = opts.now ?? new Date();
  // No campaign segregation needed — Anchor Frame mailboxes are attached to
  // both campaigns, so warmed count is shared. We probe from one campaign.
  const mailboxes =
    opts.mailboxes
    ?? (await listCampaignMailboxes(SMARTLEAD_CAMPAIGNS.no_site));
  const warmed = countWarmedMailboxes(mailboxes);

  const rawCapacity = Math.floor((warmed * PER_MAILBOX_DAILY_CAP * HEADROOM) / SENDS_PER_LEAD);
  const ceiling = funnelConfig.max_daily_sends;
  const targetIntake = Math.min(rawCapacity, ceiling);

  const sb =
    opts.supabase
    ?? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // UTC day window. We use UTC because Vercel cron schedules in UTC; ET
  // skew of ±4h doesn't change the cap meaningfully.
  const dayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )).toISOString();

  const { count: pushedToday } = await sb
    .from("lead_funnel_state")
    .select("lead_id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("pushed_to_smartlead_at", dayStart);

  const remaining = Math.max(0, targetIntake - (pushedToday ?? 0));

  return {
    warmed_mailboxes: warmed,
    raw_capacity: rawCapacity,
    config_ceiling: ceiling,
    pushed_today: pushedToday ?? 0,
    remaining_intake: remaining,
  };
}
