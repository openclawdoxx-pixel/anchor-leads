-- One row per funnel batch run (nightly orchestrator cron + threading cron).
-- Aggregates token usage + lead counts; gives Kurt a paper trail for billing
-- and post-mortem when something goes sideways.
create table if not exists funnel_runs (
  id                 uuid primary key default gen_random_uuid(),
  run_date           date not null,
  status             text not null check (status in ('running', 'completed', 'failed')),
  leads_attempted    int,
  leads_sent         int,
  leads_failed       int,
  agent_token_usage  jsonb,
  error_summary      text,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create index if not exists idx_funnel_runs_run_date
  on funnel_runs (run_date desc);

alter table funnel_runs enable row level security;
