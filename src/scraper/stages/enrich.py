"""Lean enrichment: email + owner name only.

Sources:
  1. Plumber's own website — primary (mailto links, Contact/About pages)
  2. Yellow Pages listing — fallback for email only

Dropped entirely:
  - Google Maps (rate-limited / CAPTCHA)
  - Yelp (CAPTCHA)
  - Review count, rating, hero_snapshot, site_builder, chat widget detection
  - Facebook lookup
  - LLM scoring

Zero Claude tokens. Pure Playwright + regex.
"""

import asyncio
from playwright.async_api import BrowserContext
from scraper.db import Database
from scraper.models import Lead, LeadStatus, LeadEnrichment
from scraper.browser import browser_context, fetch_page_html, polite_wait
from scraper.enrichment.owner import extract_from_about_page
from scraper.enrichment.email_finder import find_email_from_website, find_data_from_yellowpages

CONCURRENCY = 5


async def _owner_from_website(context: BrowserContext, website: str) -> str | None:
    if not website:
        return None
    if not website.startswith("http"):
        website = "https://" + website
    base = website.rstrip("/")
    for path in ["/about", "/about-us", "/our-team", "/team", ""]:
        try:
            html = await fetch_page_html(context, base + path, timeout_ms=10000)
            name = extract_from_about_page(html)
            if name:
                return name
        except Exception:
            continue
    return None


async def enrich_one(lead: Lead, context: BrowserContext, db: Database) -> None:
    """Lean enrichment: chase email + owner name, nothing else."""
    assert lead.id is not None

    email: str | None = None
    owner: str | None = None

    # Tier 1: plumber's own website
    if lead.website:
        try:
            email = await find_email_from_website(context, lead.website)
        except Exception as exc:
            print(f"[enrich] website email fail {lead.company_name}: {exc}")
        try:
            owner = await _owner_from_website(context, lead.website)
        except Exception as exc:
            print(f"[enrich] website owner fail {lead.company_name}: {exc}")

    # Tier 2: Yellow Pages — email fallback only, no rating scrape
    if not email:
        try:
            yp = await find_data_from_yellowpages(
                context,
                lead.company_name,
                lead.city or "",
                lead.state or "",
            )
            if yp.get("email"):
                email = yp["email"]
        except Exception as exc:
            print(f"[enrich] yellowpages fail {lead.company_name}: {exc}")

    # Write to lead_enrichment via raw upsert (bypasses pydantic for email column)
    payload: dict = {"lead_id": str(lead.id)}
    if owner:
        payload["owner_name"] = owner
    if email:
        payload["email"] = email
    db.client.table("lead_enrichment").upsert(payload).execute()

    db.update_lead_status(lead.id, LeadStatus.ENRICHED)
    await polite_wait(min_s=0.8, max_s=2.0)


async def _enrich_with_sem(lead: Lead, context: BrowserContext, db: Database, sem: asyncio.Semaphore) -> str:
    async with sem:
        try:
            await enrich_one(lead, context, db)
            return "ok"
        except Exception as e:
            print(f"[enrich] failed {lead.company_name}: {e}")
            if lead.id:
                db.update_lead_status(lead.id, LeadStatus.ENRICHMENT_FAILED)
            return "fail"


async def run_enrich(db: Database, limit: int = 500) -> dict[str, int]:
    leads = db.fetch_leads_by_status(LeadStatus.QUALIFIED, limit=limit)
    if not leads:
        return {"processed": 0, "succeeded": 0, "failed": 0}

    sem = asyncio.Semaphore(CONCURRENCY)
    async with browser_context() as context:
        results = await asyncio.gather(
            *[_enrich_with_sem(lead, context, db, sem) for lead in leads]
        )
    succeeded = sum(1 for r in results if r == "ok")
    failed = sum(1 for r in results if r == "fail")
    return {"processed": len(leads), "succeeded": succeeded, "failed": failed}


# Kept for test compatibility
def apply_final_icp(e: LeadEnrichment) -> bool:
    return True
