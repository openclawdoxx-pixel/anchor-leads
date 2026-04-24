-- Track when a lead was last scanned via Facebook so we don't re-run
-- empty-result leads every overnight loop. Null = never checked; set to
-- now() after every facebook-enrich attempt regardless of hit/miss.
alter table lead_enrichment
  add column if not exists fb_checked_at timestamptz;

create index if not exists idx_lead_enrichment_fb_checked_at
  on lead_enrichment (fb_checked_at)
  where fb_checked_at is null;
