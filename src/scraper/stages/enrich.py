from playwright.async_api import BrowserContext
from tenacity import retry, stop_after_attempt, wait_exponential
from scraper.db import Database
from scraper.models import Lead, LeadStatus, LeadEnrichment, BookingPathQuality
from scraper.browser import browser_context, fetch_page_html, polite_wait
from scraper.enrichment.website import analyze_html
from scraper.enrichment.google_maps import enrich_via_google
from scraper.enrichment.owner import lookup_owner
from scraper.enrichment.facebook import lookup_facebook

BAD_BUILDERS = {"wix", "godaddy", "none"}

def apply_final_icp(e: LeadEnrichment) -> bool:
    """Return True if lead passes full ICP after enrichment."""
    if e.review_count is not None and e.review_count >= 100:
        return False
    if e.has_chat_widget:
        return False
    bad_signals = 0
    if e.site_builder in BAD_BUILDERS:
        bad_signals += 1
    if e.last_site_update_year and e.last_site_update_year <= 2023:
        bad_signals += 1
    if e.booking_path_quality in (BookingPathQuality.WEAK, BookingPathQuality.NONE):
        bad_signals += 1
    return bad_signals >= 1

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=16))
async def _fetch_site(context: BrowserContext, url: str) -> str:
    return await fetch_page_html(context, url)

async def enrich_one(lead: Lead, context: BrowserContext, db: Database) -> None:
    assert lead.id is not None
    site_data: dict = {}
    if lead.website:
        try:
            html = await _fetch_site(context, lead.website)
            site_data = analyze_html(html)
        except Exception as e:
            print(f"[enrich] site fetch failed for {lead.website}: {e}")

    gmaps = await enrich_via_google(context, lead.company_name, lead.city or lead.state)
    owner = await lookup_owner(context, lead.website, gmaps.get("review_samples", []))
    fb = await lookup_facebook(context, lead.company_name, lead.city or lead.state)

    booking_quality_raw = site_data.get("booking_path_quality")
    booking_quality = BookingPathQuality(booking_quality_raw) if booking_quality_raw else None

    enrichment = LeadEnrichment(
        lead_id=lead.id,
        owner_name=owner,
        review_count=gmaps.get("review_count"),
        rating=gmaps.get("rating"),
        site_builder=site_data.get("site_builder"),
        has_chat_widget=site_data.get("has_chat_widget"),
        chat_widget_vendor=site_data.get("chat_widget_vendor"),
        has_ai_signals=site_data.get("has_ai_signals"),
        last_site_update_year=site_data.get("last_site_update_year"),
        hero_snapshot=site_data.get("hero_snapshot"),
        booking_path_quality=booking_quality,
        facebook_url=fb.get("facebook_url"),
        facebook_last_post=fb.get("facebook_last_post"),
        review_samples=gmaps.get("review_samples", []),
        raw_site_text=site_data.get("raw_site_text"),
    )
    db.upsert_enrichment(enrichment)

    passed = apply_final_icp(enrichment)
    if not passed:
        db.update_lead_status(lead.id, LeadStatus.REJECTED)
    else:
        if gmaps.get("place_id"):
            db.client.table("leads").update({"place_id": gmaps["place_id"]}).eq("id", str(lead.id)).execute()
        db.update_lead_status(lead.id, LeadStatus.ENRICHED)
    await polite_wait()

async def run_enrich(db: Database, limit: int = 500) -> dict[str, int]:
    leads = db.fetch_leads_by_status(LeadStatus.QUALIFIED, limit=limit)
    succeeded = failed = 0
    async with browser_context() as context:
        for lead in leads:
            try:
                await enrich_one(lead, context, db)
                succeeded += 1
            except Exception as e:
                print(f"[enrich] failed {lead.company_name}: {e}")
                if lead.id:
                    db.update_lead_status(lead.id, LeadStatus.ENRICHMENT_FAILED)
                failed += 1
    return {"processed": len(leads), "succeeded": succeeded, "failed": failed}
