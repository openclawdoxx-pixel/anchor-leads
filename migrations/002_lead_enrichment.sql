create table if not exists lead_enrichment (
  lead_id                uuid primary key references leads(id) on delete cascade,
  owner_name             text,
  review_count           int,
  rating                 float,
  site_builder           text,
  has_chat_widget        boolean,
  chat_widget_vendor     text,
  has_ai_signals         boolean,
  last_site_update_year  int,
  hero_snapshot          jsonb,
  booking_path_quality   text,
  facebook_url           text,
  facebook_last_post     date,
  review_samples         jsonb,
  raw_site_text          text,
  enriched_at            timestamptz not null default now()
);
