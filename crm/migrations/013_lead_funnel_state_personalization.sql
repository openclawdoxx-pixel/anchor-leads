-- 013: per-lead personalization output stored alongside funnel state.
--
-- Holds the JSON output of research + personalize agents (run locally
-- via Claude Code subagents on Max plan, or via Anthropic API later).
-- /l/[slug]/site/route.ts reads this column at request time and applies
-- it to the template via render.ts applyDiffs().
--
-- Shape (loose — JSON):
--   {
--     "research": {
--       "best_review_quote": string|null,
--       "best_review_attribution": string|null,
--       "distinctive_services": [string],
--       "local_callout": string|null,
--       "tone_hint": "professional"|"folksy"|"urgent"|"established",
--       "visual_color_hint": string|null
--     },
--     "personalization": {
--       "hero_tagline": string,
--       "review_block_html": string,
--       "city_callout": string,
--       "color_overrides": {primary, accent} | null
--     }
--   }
--
-- Default '{}' means "no personalization yet" — render falls back to
-- applyLeadBasics-only (just name swap, no review/tagline override).

alter table lead_funnel_state
  add column if not exists personalization jsonb not null default '{}'::jsonb;
