create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  overture_id     text unique,
  place_id        text unique,
  company_name    text not null,
  phone           text,
  website         text,
  address         text,
  city            text,
  state           text not null,
  lat             double precision,
  lng             double precision,
  status          text not null default 'discovered',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_state_idx on leads (state);
