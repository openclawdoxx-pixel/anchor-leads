from unittest.mock import MagicMock
from uuid import uuid4
from scraper.stages.score import run_score
from scraper.models import Lead, LeadStatus, LeadNotes, BestPitch

def test_run_score_calls_llm_and_writes_notes():
    mock_db = MagicMock()
    lid = uuid4()
    mock_db.fetch_leads_by_status.return_value = [
        Lead(id=lid, company_name="Acme", state="NY", status=LeadStatus.ENRICHED)
    ]
    mock_db.fetch_enrichment.return_value = {"review_count": 12, "site_builder": "wix"}
    mock_scorer = MagicMock()
    mock_scorer.score.return_value = LeadNotes(
        lead_id=lid, attack_angles=["x"], review_themes=[], digital_maturity=3,
        ai_summary="small shop", best_pitch=BestPitch.WEBSITE,
    )
    result = run_score(db=mock_db, scorer=mock_scorer, limit=1)
    assert result["succeeded"] == 1
    mock_db.upsert_notes.assert_called_once()
    mock_db.update_lead_status.assert_called_once_with(lid, LeadStatus.SCORED)
