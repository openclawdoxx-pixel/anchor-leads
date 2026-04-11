create table if not exists lead_notes (
  lead_id          uuid primary key references leads(id) on delete cascade,
  attack_angles    jsonb,
  review_themes    jsonb,
  digital_maturity int,
  ai_summary       text,
  best_pitch       text,
  scored_at        timestamptz not null default now()
);
