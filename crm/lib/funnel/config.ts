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

export const SMARTLEAD_CAMPAIGNS = {
  /** Parent campaign for leads with no existing website. Email 1 uses Version A. */
  no_site: 3224195,
  /** Parent campaign for leads with an existing website. Email 1 uses Version B. */
  has_site: 3238040,
  /** Subsequence for No Site clickers (Path B Email 2). Trigger configured in UI. */
  no_site_path_b: 3238049,
  /** Subsequence for Has Site clickers (Path B Email 2). Trigger configured in UI. */
  has_site_path_b: 3238050,
} as const;

export const SMARTLEAD_MAILBOX_IDS = [17733583, 17733579, 17733543] as const;

/**
 * Threaded replies the orchestrator sends via `smartlead inbox reply` —
 * NOT part of Smartlead's sequence. The orchestrator fires these at
 * Day 3 (Email 2, threaded under Email 1) and Day 21 (Email 6, threaded
 * under Email 5). Each reply uses the original message's email_stats_id
 * to maintain the actual Gmail/Outlook thread.
 *
 * Path A vs Path B for Email 2 is decided at reply time by checking
 * EMAIL_CLICKED webhook history per lead.
 */
export const THREADED_REPLIES = {
  /** Day 3 reply, threaded under Email 1. Fires for leads who DIDN'T click Email 1. */
  email_2_path_a: {
    delay_days_after_email_1: 3,
    body: `<p>You skipped my last email. Probably busy. I get it.</p><p>Probably also figured it was another "free" pitch… the kind where free means $97 a month after they've got your card.</p><p>Or "free setup" — and you're locked into a 12-month contract while they own your domain, your hosting, and every word of your website.</p><p>Bullshit.</p><p>Newsflash. I'm not the IRS. I'm not gonna hunt you down if you don't pay me — because you ain't paying me jack shit.</p><p>You own the site. The domain, the hosting, the whole thing.</p><p>After I hand it off, you don't ever have to hear my name again. It's yours, brother. Completely yours.</p><p>Link's below. Take a look. Book 10 minutes and the login's yours.</p><p><a href="{{custom_fields.landing_url}}">{{custom_fields.landing_url}}</a></p><p>— Kurt</p>`,
  },
  /** Day 3 reply, threaded under Email 1. Fires for leads who CLICKED Email 1. */
  email_2_path_b: {
    delay_days_after_email_1: 3,
    body: `<p>You saw what I built for {{company_name}} but didn't book. <em>What gives??</em></p><p>Newsflash. I'm not the IRS. I'm not gonna hunt you down if you don't pay me — because you ain't paying me jack shit.</p><p>You saw the site. If something on it isn't right — wrong service area, headline you'd word different, photos you'd swap — tell me on the call. I'll change it. Free. It's your site, it should look how you want.</p><p>Site's still here. Login's still in my hands. Ten minutes and that flips.</p><p><a href="{{custom_fields.landing_url}}">{{custom_fields.landing_url}}</a></p><p>— Kurt</p>`,
  },
  /** Day 3-after-Email-5 (=Day 21 from Email 1) reply, threaded under Email 5. */
  email_6: {
    delay_days_after_email_5: 3,
    body: `<p>pulling it at midnight.</p><p><a href="{{custom_fields.landing_url}}">{{custom_fields.landing_url}}</a></p><p>— Kurt</p>`,
  },
} as const;

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
