-- Threading orchestrator state. Day 3 (Email 2) and Day 21 (Email 6) replies
-- are NOT Smartlead sequence steps — Smartlead's sequence engine sends each
-- step as a NEW thread, not a reply. To thread under Email 1 (Day 3) and
-- Email 5 (Day 21) we use Smartlead's `inbox reply` API, which needs the
-- email_stats_id of the parent message. We capture those IDs from the
-- EMAIL_SENT webhook and store them per-step in a jsonb map.
--
-- Path A vs Path B for Email 2 is chosen by the runner based on whether
-- the lead clicked Email 1's landing-page link (tracked via EMAIL_CLICKED
-- webhook into clicked_email_steps).
--
-- jsonb map (vs separate columns) chosen so adding/removing steps later
-- doesn't require another migration — the schema stays stable as the
-- email sequence evolves.
alter table lead_funnel_state
  add column if not exists email_stats_ids        jsonb       not null default '{}'::jsonb,
  add column if not exists campaign_id            int,
  add column if not exists clicked_email_steps    int[]       not null default '{}'::int[],
  add column if not exists email_2_reply_sent_at  timestamptz,
  add column if not exists email_6_reply_sent_at  timestamptz,
  -- Terminal events from Smartlead (replied/bounced/unsubscribed). Once set,
  -- the threading runner skips this lead — sending a "still here?" reply to
  -- someone who already replied or unsubscribed is the worst-case footgun.
  add column if not exists terminal_event         text        check (terminal_event in ('replied', 'bounced', 'unsubscribed')),
  add column if not exists terminal_event_at      timestamptz;

-- Reply-runner hot path: find leads whose Email 1 landed N days ago, haven't
-- received their Day 3 reply yet, and haven't terminated. Partial index keeps
-- this fast even at 100k+ rows.
create index if not exists idx_lead_funnel_state_email_2_pending
  on lead_funnel_state (pushed_to_smartlead_at)
  where email_2_reply_sent_at is null
    and status = 'sent'
    and terminal_event is null;

-- Same for Day 21 (Email 6 threads under Email 5's send).
create index if not exists idx_lead_funnel_state_email_6_pending
  on lead_funnel_state (pushed_to_smartlead_at)
  where email_6_reply_sent_at is null
    and status = 'sent'
    and terminal_event is null;
