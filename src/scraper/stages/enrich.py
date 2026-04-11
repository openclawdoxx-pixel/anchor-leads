import asyncio
from playwright.async_api import BrowserContext
from scraper.db import Database
from scraper.models import Lead, LeadStatus, LeadEnrichment
from scraper.browser import browser_context, fetch_page_html, polite_wait
from scraper.enrichment.google_maps import enrich_via_google
from scraper.enrichment.owner import extract_from_review_text, extract_from_about_page
from scraper.enrichment.owner_search import search_owner_via_google

# Lite enrichment: Google Maps + light website fetch for owner name.
# No LLM scoring, no Facebook, no full site analysis. Fast and cheap.
CONCURRENCY = 5


def apply_final_icp(e: LeadEnrichment) -> bool:
    """Return True if lead passes the ICP.

    Rules (lite mode):
    - review_count >= 100 → reject (too big)
    - Otherwise → accept
    """
    if e.review_count is not None and e.review_count >= 100:
        return False
    return True


async def _owner_from_website(context: BrowserContext, website: str) -> str | None:
    """Try to pull an owner name from the website's About page. Fast, best-effort."""
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
    """Lite enrichment: Google Maps + owner name lookup."""
    assert lead.id is not None

    # Step 1: Google Maps for reviews + rating
    gmaps = await enrich_via_google(context, lead.company_name, lead.city or lead.state)
    review_count = gmaps.get("review_count")
    review_samples = gmaps.get("review_samples", [])

    # Early reject: too big
    if review_count is not None and review_count >= 100:
        db.upsert_enrichment(LeadEnrichment(
            lead_id=lead.id,
            review_count=review_count,
            rating=gmaps.get("rating"),
            review_samples=review_samples,
        ))
        db.update_lead_status(lead.id, LeadStatus.REJECTED)
        return

    # Step 2: Owner name lookup — try review samples first (free), then website about page
    owner = None
    for r in review_samples:
        candidate = extract_from_review_text(r.get("text", ""))
        if candidate:
            owner = candidate
            break

    if not owner and lead.website:
        owner = await _owner_from_website(context, lead.website)

    if not owner:
        try:
            owner = await search_owner_via_google(context, lead.company_name, lead.city or lead.state)
        except Exception:
            owner = None

    enrichment = LeadEnrichment(
        lead_id=lead.id,
        owner_name=owner,
        review_count=review_count,
        rating=gmaps.get("rating"),
        review_samples=review_samples,
    )
    db.upsert_enrichment(enrichment)

    if gmaps.get("place_id"):
        db.client.table("leads").update({"place_id": gmaps["place_id"]}).eq("id", str(lead.id)).execute()
    db.update_lead_status(lead.id, LeadStatus.ENRICHED)
    await polite_wait(min_s=1.0, max_s=3.0)


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
