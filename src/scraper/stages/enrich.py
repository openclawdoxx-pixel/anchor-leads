"""Fast enrichment: email + owner + site_builder + ICP tier.

Uses httpx (lightweight HTTP) for website scraping instead of Playwright.
Playwright was crashing Chromium at any concurrency on the Mac mini.
httpx uses ~0 RAM per request and handles 20+ concurrent easily.
"""

import asyncio
from scraper.db import Database
from scraper.models import Lead, LeadStatus, LeadEnrichment
from scraper.http_fetch import fetch_html
from scraper.enrichment.owner import extract_from_about_page
from scraper.enrichment.website import detect_site_builder
from scraper.enrichment.email_finder import extract_emails_from_html, find_data_from_yellowpages
from scraper.enrichment.email_guess import guess_email

CONCURRENCY = 20  # httpx handles 20 easily — no browser, no RAM pressure

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


async def enrich_one(lead: Lead, db: Database) -> None:
    """Enrichment via httpx (no browser). 3 pages max per lead."""
    assert lead.id is not None

    email: str | None = None
    owner: str | None = None
    site_builder: str | None = None

    if lead.website:
        base = lead.website if lead.website.startswith("http") else "https://" + lead.website
        base = base.rstrip("/")

        # Page 1: Homepage
        homepage = await fetch_html(base)
        if homepage:
            site_builder = detect_site_builder(homepage)
            emails = extract_emails_from_html(homepage)
            if emails:
                email = emails[0]

        # Page 2: /contact (only if no email yet)
        if not email:
            contact = await fetch_html(base + "/contact")
            if contact:
                emails = extract_emails_from_html(contact)
                if emails:
                    email = emails[0]

        # Page 3: /about (for owner name)
        about = await fetch_html(base + "/about")
        if about:
            owner = extract_from_about_page(about)
            if not email:
                emails = extract_emails_from_html(about)
                if emails:
                    email = emails[0]

    # Tier 2: Yellow Pages (uses httpx internally too — no browser needed)
    # Skip YP for now to keep it pure httpx — YP needs Playwright for JS rendering
    # We'll add it back in the Facebook pass if needed.

    # Tier 3: Email pattern guessing
    if not email and owner and lead.website:
        try:
            email = guess_email(owner, lead.website)
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


async def _enrich_with_sem(lead: Lead, db: Database, sem: asyncio.Semaphore) -> str:
    async with sem:
        try:
            await enrich_one(lead, db)
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
    results = await asyncio.gather(
        *[_enrich_with_sem(lead, db, sem) for lead in leads]
    )
    succeeded = sum(1 for r in results if r == "ok")
    failed = sum(1 for r in results if r == "fail")
    return {"processed": len(leads), "succeeded": succeeded, "failed": failed}
