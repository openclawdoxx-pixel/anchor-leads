# Facebook Fast Enrichment — Design Spec

**Date:** 2026-04-24
**Project:** anchor-leads (scraper perf)
**Status:** approved, implementation starting

---

## 1. Purpose

Replace the Playwright-driven Facebook enrichment pass with a plain-HTTP path against `mbasic.facebook.com`, keeping Playwright as a fallback. Goal: finish the outstanding FB pass on enriched-no-email leads in hours instead of weeks.

Playwright is the bottleneck: ~3s/lead including polite wait, single session, Chromium RAM ceiling at ~5 concurrent. The FB pass has effectively stalled. `mbasic.facebook.com` is Facebook's server-rendered low-bandwidth site — flat HTML, same cookies, parses cleanly with `httpx + BeautifulSoup`.

This is a perf change, not a scope change. Same inputs (enriched leads with no email), same outputs (email + owner_name written to `lead_enrichment`), same CLI command. Nothing downstream moves.

## 2. Non-goals

- No Instagram, Yelp, LinkedIn, Nextdoor, or other social sources. Kurt confirmed FB-only for this pass.
- No new dependencies. `httpx` and `beautifulsoup4` are already in `pyproject.toml`.
- No schema changes. `lead_enrichment.email` and `owner_name` columns exist.
- No changes to the hybrid-mode hit-rate data model, lead selection logic, or email-guess fallback — those stay identical to current `facebook-enrich`.

## 3. Architecture

### 3.1 New module: `src/scraper/enrichment/facebook_fast.py`

Exports one async function:

```python
async def enrich_via_mbasic(
    client: httpx.AsyncClient,
    company: str,
    city: str,
) -> dict[str, Any]:
    """Returns {"email": str|None, "owner_name": str|None}."""
```

Flow:
1. GET `https://mbasic.facebook.com/search/pages/?q={company city}` with session cookies
2. Parse result list anchors; pick first that contains company's first word (same matching rule as Playwright path)
3. GET the matched page URL (still on `mbasic.facebook.com`)
4. Parse HTML: regex-extract emails from full page source, filter via existing `SKIP_DOMAINS` set; apply existing `OWNER_PATTERNS` to extracted text
5. Return `{email, owner_name}`, `None` for whichever missed

Shared constants (`EMAIL_RE`, `SKIP_DOMAINS`, `OWNER_PATTERNS`, `_is_real_email`) stay in `facebook.py`; `facebook_fast.py` imports them. No duplication.

### 3.2 Cookie loading

`.fb_cookies.json` already exists and is read by the Playwright path. Same cookies work across `*.facebook.com` subdomains. `facebook_fast.py` loads the cookies once per run into the `httpx.AsyncClient`'s cookie jar.

### 3.3 Concurrency & politeness

- `asyncio.Semaphore(20)` limits in-flight requests
- `await asyncio.sleep(random.uniform(0.4, 1.0))` between requests per worker
- Shared `httpx.AsyncClient` with `http2=True`, `timeout=15`, realistic User-Agent and `Accept-Language`

Target throughput: ~8k/hr sustained. Worst case with aggressive rate-limiting: ~3k/hr, still 4× current.

### 3.4 CLI integration: `scraper facebook-enrich --mode {hybrid,fast,playwright}`

Modify `facebook_enrich_cmd` in `src/scraper/cli.py`:

- Add `--mode` typer option, default `hybrid`
- `fast`: only `enrich_via_mbasic`
- `playwright`: unchanged existing behavior (current Playwright loop)
- `hybrid`: call `enrich_via_mbasic` first; if it returns `{email: None, owner_name: None}`, fall back to `enrich_via_facebook` for that lead

All existing behavior stays: lead selection (enriched + no email, prioritize no-website), email-guess fallback via owner, `lead_enrichment` update logic, `--loop` support, pagination with `offset` + per-session `checked` set.

### 3.5 Stale rule cleanup

`anchor-leads/CLAUDE.md` line `Skip: facebook, site_builder detection, ...` is stale (Kurt confirmed). Remove `facebook,` from that rule.

## 4. Error handling

- Network errors / 5xx / timeouts: log `fail {company}: {exc}`, return empty dict, continue loop (same as Playwright path)
- Facebook serves a login wall: detect by string `log in to Facebook` in response body; treat as cookie expiry and exit loop with clear message pointing to `scripts/health_check.sh` relogin
- No results on search page: return empty dict
- Parse errors on page HTML: return empty dict, don't crash

## 5. Testing

1. **Unit test** (`tests/test_facebook_fast.py`): mock httpx with `respx`, feed fixture HTML captured from real mbasic search + page, assert email + owner extracted correctly. One success case, one no-results case, one cookie-expired case.
2. **Live 200-lead sample**: run `scraper facebook-enrich --mode hybrid --limit 200` against current Supabase. Record in commit message: (a) mbasic hit rate, (b) fallback Playwright hit rate on mbasic misses, (c) mean seconds per lead, (d) comparison to current ~3s/lead.
3. **Acceptance gate to keep hybrid**: mbasic hit rate ≥ 70% of Playwright's hit rate on the same sample. Below that, revisit approach before scaling.

## 6. Follow-up (out of scope for this spec)

- If mbasic hit rate ≥ 90% of Playwright's over the first 2k leads, open a follow-up to delete `enrich_via_facebook` and the `browser_context` dependency from the FB path entirely.
- If FB pass completes on current backlog, revisit OpenCLI for multi-platform enrichment (Yelp, Nextdoor) — explicitly deferred now.

## 7. Risk ledger

| Risk | Mitigation |
|---|---|
| Cookies don't transfer cleanly to mbasic subdomain | Verified `datr` cookie is set `.facebook.com` domain-wide; test live with 5 leads before full run |
| Facebook rate-limits mbasic harder than desktop | Semaphore + jitter; fallback to Playwright per-lead catches the gap |
| mbasic HTML structure changes | Unit test with captured fixture fails loudly; regex-on-full-source approach is more resilient than DOM selectors |
| Silent degradation vs Playwright | Hybrid mode makes drops visible in logs; acceptance gate requires evidence before full rollout |
