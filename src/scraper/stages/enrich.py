"""Enrichment: email + owner name + site_builder (for ICP tiering).

Sources:
  1. Plumber's own website — email, owner name, site builder detection
  2. Yellow Pages listing — email fallback

ICP tier (written to lead_enrichment.icp_tier):
  HOT  = no website OR bad site (wix/godaddy) → needs Anchor Frame most
  WARM = has website, quality unknown → probably good lead
  COLD = has modern custom website → less likely to need service

Zero Claude tokens. Pure Playwright + regex.
"""

import asyncio
from playwright.async_api import BrowserContext
from scraper.db import Database
from scraper.models import Lead, LeadStatus, LeadEnrichment
from scraper.browser import browser_context, fetch_page_html, polite_wait
from scraper.enrichment.owner import extract_from_about_page
from scraper.enrichment.website import detect_site_builder
from scraper.enrichment.email_finder import find_email_from_website, find_data_from_yellowpages

CONCURRENCY = 5

BAD_BUILDERS = {"wix", "godaddy", "squarespace", "none"}
GOOD_BUILDERS = {"custom"}


def compute_icp_tier(site_builder: str | None, has_website: bool, review_count: int | None) -> str:
    """Determine ICP tier from available signals."""
    # Big fish check first
    if review_count is not None and review_count >= 100:
        return "cold"
    # No website at all = strongest signal they need one
    if not has_website:
        return "hot"
    # Bad website builder = strong signal
    if site_builder and site_builder in BAD_BUILDERS:
        return "hot"
    # Good custom website = probably doesn't need us
    if site_builder and site_builder in GOOD_BUILDERS:
        return "cold"
    # Can't tell = warm (benefit of doubt)
    return "warm"


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
    """Enrichment: email + owner + site_builder + ICP tier."""
    assert lead.id is not None

    email: str | None = None
    owner: str | None = None
    site_builder: str | None = None
    homepage_html: str | None = None

    # Tier 1: plumber's own website
    if lead.website:
        ws = lead.website if lead.website.startswith("http") else "https://" + lead.website
        try:
            homepage_html = await fetch_page_html(context, ws, timeout_ms=12000)
        except Exception:
            homepage_html = None

        if homepage_html:
            # Email from homepage + contact/about pages
            try:
                email = await find_email_from_website(context, lead.website)
            except Exception as exc:
                print(f"[enrich] website email fail {lead.company_name}: {exc}")

            # Owner from about pages
            try:
                owner = await _owner_from_website(context, lead.website)
            except Exception as exc:
                print(f"[enrich] website owner fail {lead.company_name}: {exc}")

            # Site builder detection (piggybacked, zero extra cost)
            site_builder = detect_site_builder(homepage_html)

    # Tier 2: Yellow Pages — email fallback
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

    # Compute ICP tier
    existing = db.client.table("lead_enrichment").select("review_count").eq("lead_id", str(lead.id)).execute().data
    review_count = existing[0].get("review_count") if existing else None
    icp_tier = compute_icp_tier(site_builder, bool(lead.website), review_count)

    # Write enrichment
    payload: dict = {"lead_id": str(lead.id)}
    if owner:
        payload["owner_name"] = owner
    if email:
        payload["email"] = email
    if site_builder:
        payload["site_builder"] = site_builder
    payload["icp_tier"] = icp_tier
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
