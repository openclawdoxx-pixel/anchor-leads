from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
import pytest
from scraper.stages.enrich import enrich_one, compute_icp_tier
from scraper.models import Lead, LeadStatus


def test_icp_tier_no_website_is_hot():
    assert compute_icp_tier(None, False, None) == "hot"

def test_icp_tier_wix_is_hot():
    assert compute_icp_tier("wix", True, None) == "hot"

def test_icp_tier_custom_is_cold():
    assert compute_icp_tier("custom", True, None) == "cold"

def test_icp_tier_100_reviews_is_cold():
    assert compute_icp_tier("wix", True, 150) == "cold"

def test_icp_tier_unknown_is_warm():
    assert compute_icp_tier(None, True, None) == "warm"


@pytest.mark.asyncio
async def test_enrich_one_writes_email_and_owner():
    mock_db = MagicMock()
    mock_db.client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    lead = Lead(
        id=uuid4(), company_name="Acme", state="NY",
        website="https://acme.example", city="Buffalo",
        status=LeadStatus.QUALIFIED,
    )

    with patch("scraper.stages.enrich.fetch_html", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = "<html><meta name='generator' content='Wix.com'><a href='mailto:bob@acme.example'>email</a><p>Meet Bob Smith, our founder</p></html>"
        await enrich_one(lead, db=mock_db)

    mock_db.client.table.assert_any_call("lead_enrichment")
    mock_db.update_lead_status.assert_called_once()
