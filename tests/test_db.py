from unittest.mock import MagicMock
from uuid import uuid4
from scraper.db import Database
from scraper.models import Lead, LeadStatus

def test_database_upserts_lead_by_overture_id():
    mock_client = MagicMock()
    db = Database(client=mock_client)
    lead = Lead(company_name="Acme", state="NY", overture_id="ovt-1")
    db.upsert_lead(lead)
    mock_client.table.assert_called_with("leads")
    mock_client.table.return_value.upsert.assert_called_once()

def test_database_fetches_leads_by_status():
    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
        {"id": str(uuid4()), "company_name": "Acme", "state": "NY", "status": "qualified"}
    ]
    db = Database(client=mock_client)
    leads = db.fetch_leads_by_status(LeadStatus.QUALIFIED, limit=10)
    assert len(leads) == 1
    assert leads[0].company_name == "Acme"
