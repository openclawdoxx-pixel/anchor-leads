create table if not exists team_members (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'caller',
  created_at  timestamptz not null default now()
);

-- RLS: only team members can read team_members
alter table team_members enable row level security;
create policy "team members can read team" on team_members
  for select using (auth.uid() in (select id from team_members));
create policy "owners can insert team" on team_members
  for insert with check (
    auth.uid() in (select id from team_members where role in ('owner','admin'))
    or not exists (select 1 from team_members)
  );
