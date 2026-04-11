from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from scraper.stages.enrich import enrich_one
from scraper.models import Lead, LeadStatus


@pytest.mark.asyncio
async def test_enrich_one_writes_email_and_owner():
    mock_db = MagicMock()
    mock_context = MagicMock()
    lead = Lead(
        id=uuid4(),
        company_name="Acme",
        state="NY",
        website="https://acme.example",
        city="Buffalo",
        status=LeadStatus.QUALIFIED,
    )

    import scraper.stages.enrich as mod
    mod.find_email_from_website = AsyncMock(return_value="bob@acme.example")
    mod._owner_from_website = AsyncMock(return_value="Bob Smith")
    mod.find_data_from_yellowpages = AsyncMock(return_value={})

    await enrich_one(lead, context=mock_context, db=mock_db)

    mock_db.client.table.assert_any_call("lead_enrichment")
    mock_db.update_lead_status.assert_called_once()
    # Should have called update_lead_status with ENRICHED
    call_args = mock_db.update_lead_status.call_args
    assert call_args[0][1] == LeadStatus.ENRICHED


@pytest.mark.asyncio
async def test_enrich_one_falls_back_to_yellowpages_for_email():
    mock_db = MagicMock()
    mock_context = MagicMock()
    lead = Lead(
        id=uuid4(),
        company_name="Acme",
        state="NY",
        website=None,  # no website → skip tier 1
        city="Buffalo",
        status=LeadStatus.QUALIFIED,
    )

    import scraper.stages.enrich as mod
    mod.find_email_from_website = AsyncMock(return_value=None)
    mod._owner_from_website = AsyncMock(return_value=None)
    mod.find_data_from_yellowpages = AsyncMock(return_value={"email": "info@acme.example"})

    await enrich_one(lead, context=mock_context, db=mock_db)

    mock_db.client.table.assert_any_call("lead_enrichment")
    mock_db.update_lead_status.assert_called_once()
