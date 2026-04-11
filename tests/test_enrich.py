from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from scraper.stages.enrich import apply_final_icp, enrich_one
from scraper.models import Lead, LeadStatus, LeadEnrichment, BookingPathQuality

def test_apply_final_icp_rejects_over_100_reviews():
    e = LeadEnrichment(lead_id=uuid4(), review_count=150)
    assert apply_final_icp(e) is False

def test_apply_final_icp_accepts_small_shop_with_bad_site():
    e = LeadEnrichment(
        lead_id=uuid4(),
        review_count=15,
        site_builder="wix",
        has_chat_widget=False,
        booking_path_quality=BookingPathQuality.NONE,
    )
    assert apply_final_icp(e) is True

def test_apply_final_icp_rejects_modern_site_with_chat():
    e = LeadEnrichment(
        lead_id=uuid4(),
        review_count=20,
        site_builder="custom",
        has_chat_widget=True,
        last_site_update_year=2025,
        booking_path_quality=BookingPathQuality.STRONG,
    )
    assert apply_final_icp(e) is False

@pytest.mark.asyncio
async def test_enrich_one_writes_enrichment_and_updates_status():
    mock_db = MagicMock()
    mock_context = MagicMock()
    lead = Lead(id=uuid4(), company_name="Acme", state="NY", website=None, city="Buffalo", status=LeadStatus.QUALIFIED)

    import scraper.stages.enrich as mod
    mod.analyze_html = lambda _: {
        "site_builder": "none", "has_chat_widget": False, "chat_widget_vendor": None,
        "has_ai_signals": False, "last_site_update_year": None,
        "hero_snapshot": None, "booking_path_quality": "none", "raw_site_text": "",
    }
    mod.enrich_via_google = AsyncMock(return_value={
        "place_id": "x", "rating": 4.5, "review_count": 12, "review_samples": [],
    })
    mod.lookup_owner = AsyncMock(return_value="Bob")
    mod.lookup_facebook = AsyncMock(return_value={"facebook_url": None, "facebook_last_post": None})
    mod._fetch_site = AsyncMock(return_value="<html></html>")

    await enrich_one(lead, context=mock_context, db=mock_db)
    mock_db.upsert_enrichment.assert_called_once()
    mock_db.update_lead_status.assert_called_once()
