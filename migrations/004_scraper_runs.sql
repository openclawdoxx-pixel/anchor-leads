create table if not exists scraper_runs (
  id         uuid primary key default gen_random_uuid(),
  stage      text not null,
  state      text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  processed  int default 0,
  succeeded  int default 0,
  failed     int default 0,
  notes      text
);
