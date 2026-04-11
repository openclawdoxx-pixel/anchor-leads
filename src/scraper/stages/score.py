from scraper.db import Database
from scraper.llm import LLMScorer
from scraper.models import LeadStatus

def run_score(db: Database, scorer: LLMScorer, limit: int = 500) -> dict[str, int]:
    leads = db.fetch_leads_by_status(LeadStatus.ENRICHED, limit=limit)
    succeeded = failed = 0
    for lead in leads:
        assert lead.id is not None
        try:
            enrichment = db.fetch_enrichment(lead.id)
            if not enrichment:
                print(f"[score] no enrichment for {lead.company_name}")
                failed += 1
                continue
            notes = scorer.score(lead.id, enrichment)
            db.upsert_notes(notes)
            db.update_lead_status(lead.id, LeadStatus.SCORED)
            succeeded += 1
        except Exception as e:
            print(f"[score] failed {lead.company_name}: {e}")
            failed += 1
    return {"processed": len(leads), "succeeded": succeeded, "failed": failed}
