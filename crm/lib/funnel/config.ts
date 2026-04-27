/**
 * FUNNEL CONFIG — single source of truth Kurt edits.
 *
 * Everything in this file is read by the orchestrator each nightly run.
 * Edit values here, redeploy, and the next 6 AM ET cron picks them up.
 *
 * What lives here (vs Vercel env vars):
 *   - Email copy (the actual body text sent to leads)
 *   - Campaign structure (sequence steps, follow-up delays, A/B variants)
 *   - Daily volume + pacing
 *   - Per-phase model overrides (e.g. cheaper model for Phase 4)
 *
 * What stays in env vars (because they're secrets or deployment-specific):
 *   - API keys (ANTHROPIC, SMARTLEAD, SUPABASE, TWILIO)
 *   - SMARTLEAD_CAMPAIGN_ID (numeric ID from Smartlead UI)
 *   - CRON_SECRET (auto-managed by Vercel)
 *
 * To use a new value: edit, commit, push, deploy. Cron uses new value next run.
 */

export type FunnelConfig = {
  /**
   * Daily send cap. Hard ceiling regardless of input pool size.
   * Smartlead also enforces per-mailbox caps as a second wall.
   */
  max_daily_sends: number;

  /**
   * Reply-rate floor (percent). If the most recent 7-day reply rate for the
   * current Phase falls below this, the orchestrator pauses promotion and
   * SMS-alerts Kurt. He resumes manually via the funnel_runs table.
   */
  min_reply_rate_pct: number;

  /**
   * Concurrency for the per-lead agent pipeline (research → personalize → audit).
   * Stay ≤5 to avoid hammering Anthropic's per-window rate limit on Max plan.
   */
  agent_concurrency: number;

  /**
   * Email sequence pushed to Smartlead's campaign at start of each run.
   * If the values here differ from what's in Smartlead, the orchestrator
   * calls smartlead's save-sequence endpoint to update.
   *
   * Each step is one email. Step 0 = first send. Step N = follow-up after
   * `delay_days` since previous step.
   *
   * Merge fields supported by Smartlead in body / subject:
   *   {{first_name}}        — lead's owner first name
   *   {{last_name}}         — lead's owner last name
   *   {{company_name}}      — plumbing business name
   *   {{custom_fields.landing_url}}  — unique per-lead landing page URL
   */
  email_sequence: Array<{
    /** Display name in Smartlead UI */
    step_name: string;
    /** Days since previous step (0 for first send) */
    delay_days: number;
    /** Subject line — supports merge fields */
    subject: string;
    /** Plain-text body — supports merge fields. HTML allowed but plain reads as more personal */
    body: string;
  }>;

  /**
   * Optional copy variants for A/B testing. Smartlead supports per-step variants;
   * we push them as separate variants on the same step. Empty array = no A/B.
   */
  email_variants: Array<{
    step_index: number; // 0-based index into email_sequence
    label: string;
    subject: string;
    body: string;
  }>;
};

export const funnelConfig: FunnelConfig = {
  max_daily_sends: 75,
  min_reply_rate_pct: 1.5,
  agent_concurrency: 5,

  // ────────────────────────────────────────────────────────────────────────
  // EMAIL SEQUENCE — Kurt edits this
  // ────────────────────────────────────────────────────────────────────────
  email_sequence: [
    {
      step_name: "Step 1 — Initial outreach",
      delay_days: 0,
      subject: "PLACEHOLDER — Kurt's subject for {{company_name}}",
      body: `PLACEHOLDER — Kurt's email body goes here.

Should mention {{company_name}}, address {{first_name}}, and link to {{custom_fields.landing_url}}.

Edit this file, commit, redeploy. Next nightly run uses new copy.`,
    },
    // Add Step 2, Step 3 follow-ups here. Smartlead respects delay_days.
  ],

  email_variants: [
    // Example:
    // { step_index: 0, label: "Variant B", subject: "...", body: "..." },
  ],
};
