"""Fast enrichment: email + owner + site_builder + ICP tier.

Optimized: 3-4 page loads per lead (down from 13). CONCURRENCY=15.
"""

import asyncio
from playwright.async_api import BrowserContext
from scraper.db import Database
from scraper.models import Lead, LeadStatus, LeadEnrichment
from scraper.browser import browser_context, fetch_page_html, polite_wait
from scraper.enrichment.owner import extract_from_about_page
from scraper.enrichment.website import detect_site_builder
from scraper.enrichment.email_finder import extract_emails_from_html, find_data_from_yellowpages

CONCURRENCY = 15

BAD_BUILDERS = {"wix", "godaddy", "squarespace", "none"}
GOOD_BUILDERS = {"custom"}


def compute_icp_tier(site_builder: str | None, has_website: bool, review_count: int | None) -> str:
    if review_count is not None and review_count >= 100:
        return "cold"
    if not has_website:
        return "hot"
    if site_builder and site_builder in BAD_BUILDERS:
        return "hot"
    if site_builder and site_builder in GOOD_BUILDERS:
        return "cold"
    return "warm"


async def _fetch(context: BrowserContext, url: str) -> str | None:
    try:
        return await fetch_page_html(context, url, timeout_ms=10000)
    except Exception:
        return None


async def enrich_one(lead: Lead, context: BrowserContext, db: Database) -> None:
    """Streamlined enrichment: 3-4 page loads max per lead."""
    assert lead.id is not None

    email: str | None = None
    owner: str | None = None
    site_builder: str | None = None

    if lead.website:
        ws = lead.website if lead.website.startswith("http") else "https://" + lead.website
        base = ws.rstrip("/")

        # Page 1: Homepage — extract email + site_builder in one shot
        homepage = await _fetch(context, base)
        if homepage:
            site_builder = detect_site_builder(homepage)
            emails = extract_emails_from_html(homepage)
            if emails:
                email = emails[0]

        # Page 2: /contact — only if no email from homepage
        if not email:
            contact = await _fetch(context, base + "/contact")
            if contact:
                emails = extract_emails_from_html(contact)
                if emails:
                    email = emails[0]

        # Page 3: /about — for owner name
        about = await _fetch(context, base + "/about")
        if about:
            owner = extract_from_about_page(about)
            # Also try email from about page if still missing
            if not email:
                emails = extract_emails_from_html(about)
                if emails:
                    email = emails[0]

    # Page 4: Yellow Pages — only if still no email
    if not email:
        try:
            yp = await find_data_from_yellowpages(
                context, lead.company_name, lead.city or "", lead.state or "",
            )
            if yp.get("email"):
                email = yp["email"]
        except Exception:
            pass

    # Compute ICP tier
    existing = db.client.table("lead_enrichment").select("review_count").eq("lead_id", str(lead.id)).execute().data
    review_count = existing[0].get("review_count") if existing else None
    icp_tier = compute_icp_tier(site_builder, bool(lead.website), review_count)

    # Write enrichment
    payload: dict = {"lead_id": str(lead.id), "icp_tier": icp_tier}
    if owner:
        payload["owner_name"] = owner
    if email:
        payload["email"] = email
    if site_builder:
        payload["site_builder"] = site_builder
    db.client.table("lead_enrichment").upsert(payload).execute()
    db.update_lead_status(lead.id, LeadStatus.ENRICHED)
    await polite_wait(min_s=0.3, max_s=1.0)


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
