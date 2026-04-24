# Anchor Leads — Project Rules

This file is read automatically by Claude when working in this repo. Global rules at `~/.claude/CLAUDE.md` also apply.

## Read these first

1. `tasks/workflow.md` — project-local workflow (same as global)
2. `tasks/todo.md` — active tasks
3. `tasks/lessons.md` — corrections I've captured
4. `/Users/projectatlas/Atlas/Claude/Projects/Anchor Leads.md` — full project state (Obsidian brain)

## Project-specific rules

- **No LLM scoring** — the `scraper score` stage burns ~3k tokens per lead. Never run unless Kurt explicitly asks. Keep `best_pitch`/`ai_summary`/`attack_angles` null.
- **Lite enrichment only** — Google Maps for rating/reviews/owner, website About page for owner, Google search fallback for owner. Skip: site_builder detection, chat_widget, hero_snapshot, booking_path_quality.
- **Facebook pass is active** — `scraper facebook-enrich --mode hybrid` uses mbasic.facebook.com (httpx) first, Playwright fallback on misses. Leads get `lead_enrichment.fb_checked_at` stamped after every attempt so empty-result leads aren't re-scanned next loop.
- **CSV → GHL is the product**, not the Next.js CRM. The CRM at `crm/` is a sunk-cost artifact; don't invest more there unless Kurt asks.
- **Preserve existing leads** — 44k+ leads in Supabase took real time to discover. Never wipe the `leads` table.
- **Secrets at `.env`** — never commit. Already in `.gitignore`.
- **Cold email domains are sacred** — `anchorframeleads.com` and related warmup domains should NOT be used for web traffic of any kind during the 2-week warmup.

## Python env

```bash
cd /Users/projectatlas/projects/anchor-leads && source .venv/bin/activate
```

## Key commands

- `scraper discover-nation` — pull all US plumbers from Overture in one query
- `scraper filter` — apply ICP filter (phone + franchise blacklist)
- `scraper enrich --limit 500` — enrich qualified leads via Google Maps
- `scraper export --out leads.csv` — export enriched leads as CSV for GHL
- `pytest` — run the test suite (must be ≥37 passing before commits)

## Supabase clean query

```sql
select * from leads_final order by review_count desc nulls last limit 100;
```

## Context Navigation

1. **Always query the knowledge graph first** (`graphify-out/graph.json` / `graphify-out/GRAPH_REPORT.md`) before reading raw files.
2. **Only read raw files if Kurt explicitly says so** or the graph doesn't cover what's needed.
3. **Use `graphify-out/wiki/index.md`** as the navigation entry point when it exists.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
