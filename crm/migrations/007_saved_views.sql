create table if not exists saved_views (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  filters     jsonb not null,
  created_by  uuid references team_members(id),
  is_shared   boolean default true,
  sort_order  int default 0,
  created_at  timestamptz not null default now()
);

alter table saved_views enable row level security;
create policy "team members read views" on saved_views
  for select using (auth.uid() in (select id from team_members));
create policy "team members write views" on saved_views
  for all using (auth.uid() in (select id from team_members));

-- Seed five starter views
insert into saved_views (name, filters, sort_order) values
  ('Never Called', '{"call_status":"never_called"}'::jsonb, 1),
  ('Bad Website, Owner Known', '{"site_builder":["wix","godaddy","none"],"has_owner_name":true}'::jsonb, 2),
  ('Low Reviews', '{"review_count_max":25}'::jsonb, 3),
  ('MCB Pitch, NY+PA', '{"best_pitch":["mcb"],"state":["NY","PA"]}'::jsonb, 4),
  ('No Answer - Retry Today', '{"call_status":"no_answer_recent"}'::jsonb, 5)
on conflict do nothing;
