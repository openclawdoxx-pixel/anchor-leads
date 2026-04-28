-- Funnel state per lead. Service-role writes only (from Vercel cron).
-- Tracks each lead through ICP phase tier + personalized landing + Smartlead push.
create table if not exists lead_funnel_state (
  lead_id                 uuid primary key references leads(id) on delete cascade,
  slug                    text not null unique,
  phase                   int  not null check (phase between 1 and 4),
  status                  text not null check (status in ('personalized', 'sent')),
  personalized_blob_url   text,
  smartlead_lead_id       text,
  personalized_at         timestamptz,
  pushed_to_smartlead_at  timestamptz,
  last_event_at           timestamptz not null default now()
);

create index if not exists idx_lead_funnel_state_status
  on lead_funnel_state (status);

create index if not exists idx_lead_funnel_state_phase
  on lead_funnel_state (phase);

-- Server-only table. RLS enabled with no policies = anon/authenticated denied,
-- service-role bypasses RLS so the cron + webhook handlers still write fine.
alter table lead_funnel_state enable row level security;
