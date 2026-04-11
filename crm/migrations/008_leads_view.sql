create or replace view leads_with_latest_call as
select
  l.*,
  e.review_count,
  e.rating,
  e.owner_name,
  e.site_builder,
  e.booking_path_quality,
  n.best_pitch,
  n.digital_maturity,
  n.ai_summary,
  (select outcome from call_logs cl where cl.lead_id = l.id order by cl.created_at desc limit 1) as latest_outcome,
  (select created_at from call_logs cl where cl.lead_id = l.id order by cl.created_at desc limit 1) as latest_call_at
from leads l
left join lead_enrichment e on e.lead_id = l.id
left join lead_notes n on n.lead_id = l.id;
