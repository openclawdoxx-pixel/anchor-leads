# Lessons — Anchor Leads

Repo-local. Mirrors the authoritative Obsidian log at `~/Atlas/Claude/Lessons.md`.

Append-only. Format: `## YYYY-MM-DD — short title`, what I did wrong, the correction, the rule.

---

## 2026-04-11 — Don't build what Kurt already has

**What I did**: Spent ~2 hours building a custom Next.js CRM.

**Correction**: Kurt already has GHL + power dialer. Custom CRM features duplicate his stack.

**Rule**: Check if Kurt already has the target workflow before proposing new tools.

---

## 2026-04-11 — LLM scoring is too expensive for bulk operations

**What I did**: Scored leads with `claude -p` per lead (~3k tokens each).

**Correction**: Kurt flagged usage concerns.

**Rule**: Never use LLM scoring for bulk (>100) enrichment. Regex, HTML parsing, rule-based only. LLM reserved for targeted small batches when explicitly asked.

---

## 2026-04-11 — Parse Google Maps with aria-label, not plain text regex

**What I did**: Used `([\d,]+)\s*reviews?` on whole HTML.

**Correction**: Google Maps has multiple places' review counts on the same page; first match is usually wrong.

**Rule**: For Google Maps HTML extraction, use unique `aria-label` attributes to scope to the selected place's panel.

---

## 2026-04-11 — Bbox discovery has gaps; nation-wide is cleaner

**What I did**: Ran Overture discovery state-by-state with bboxes.

**Correction**: State bboxes are rectangular, states are irregular. Gaps drop plumbers. Got 44k vs 107k available.

**Rule**: For US-wide queries, prefer a single `country = 'US'` query over per-state bbox iteration.
