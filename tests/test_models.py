from uuid import uuid4
from scraper.models import Lead, LeadEnrichment, LeadNotes, LeadStatus, BestPitch

def test_lead_has_required_fields():
    lead = Lead(
        company_name="Acme Plumbing",
        state="NY",
        status=LeadStatus.DISCOVERED,
    )
    assert lead.company_name == "Acme Plumbing"
    assert lead.status == LeadStatus.DISCOVERED

def test_enrichment_allows_all_fields_optional_except_lead_id():
    lid = uuid4()
    e = LeadEnrichment(lead_id=lid)
    assert e.lead_id == lid
    assert e.review_count is None

def test_notes_accepts_best_pitch_enum():
    lid = uuid4()
    n = LeadNotes(
        lead_id=lid,
        attack_angles=["Only 8 reviews"],
        review_themes=[],
        digital_maturity=3,
        ai_summary="small shop",
        best_pitch=BestPitch.REPUTATION,
    )
    assert n.best_pitch == BestPitch.REPUTATION
