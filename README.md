# anchor-leads

Plumber lead scraper + enrichment pipeline feeding Supabase.

## Setup

1. `python -m venv .venv && source .venv/bin/activate`
2. `pip install -e ".[dev]"`
3. `playwright install chromium`
4. Copy `.env.example` to `.env` and fill in Supabase + Anthropic keys
5. Run migrations: paste each `migrations/*.sql` into the Supabase SQL Editor
6. `scraper discover --state NY`

See `docs/superpowers/specs/` for the full design.
