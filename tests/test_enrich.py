from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from scraper.stages.enrich import apply_final_icp, enrich_one
from scraper.models import Lead, LeadStatus, LeadEnrichment


def test_apply_final_icp_rejects_over_100_reviews():
    e = LeadEnrichment(lead_id=uuid4(), review_count=150)
    assert apply_final_icp(e) is False


def test_apply_final_icp_accepts_small_shop():
    e = LeadEnrichment(lead_id=uuid4(), review_count=15)
    assert apply_final_icp(e) is True


def test_apply_final_icp_accepts_when_review_count_unknown():
    e = LeadEnrichment(lead_id=uuid4(), review_count=None)
    assert apply_final_icp(e) is True


@pytest.mark.asyncio
async def test_enrich_one_writes_enrichment_and_updates_status():
    mock_db = MagicMock()
    mock_context = MagicMock()
    lead = Lead(
        id=uuid4(),
        company_name="Acme",
        state="NY",
        website=None,
        city="Buffalo",
        status=LeadStatus.QUALIFIED,
    )

    import scraper.stages.enrich as mod
    mod.enrich_via_google = AsyncMock(return_value={
        "place_id": "x",
        "rating": 4.5,
        "review_count": 12,
        "review_samples": [{"text": "The owner Bob Smith was great"}],
    })

    await enrich_one(lead, context=mock_context, db=mock_db)
    mock_db.upsert_enrichment.assert_called_once()
    mock_db.update_lead_status.assert_called_once()
    # owner should be extracted from review text
    written = mock_db.upsert_enrichment.call_args[0][0]
    assert written.owner_name == "Bob Smith"
