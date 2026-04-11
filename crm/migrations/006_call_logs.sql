create table if not exists call_logs (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  caller_id   uuid not null references team_members(id),
  outcome     text not null,
  notes       text,
  pitch_used  text,
  duration_s  int,
  created_at  timestamptz not null default now()
);
create index if not exists call_logs_lead_idx on call_logs (lead_id, created_at desc);
create index if not exists call_logs_caller_idx on call_logs (caller_id, created_at desc);
create index if not exists call_logs_created_idx on call_logs (created_at desc);

alter table call_logs enable row level security;
create policy "team members read call logs" on call_logs
  for select using (auth.uid() in (select id from team_members));
create policy "team members insert own call logs" on call_logs
  for insert with check (caller_id = auth.uid());
