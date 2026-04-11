from scraper.db import Database
from scraper.models import LeadStatus

def run_filter(db: Database) -> dict[str, int]:
    """Apply stage-2 ICP filter: must have phone and state. Leaves review/site checks to stage 3."""
    client = db.client

    # Qualify: discovered leads with a phone
    q = (
        client.table("leads")
        .update({"status": LeadStatus.QUALIFIED.value})
        .eq("status", LeadStatus.DISCOVERED.value)
        .not_.is_("phone", "null")
        .execute()
    )
    qualified = len(q.data or [])

    # Reject: discovered leads without a phone
    r = (
        client.table("leads")
        .update({"status": LeadStatus.REJECTED.value})
        .eq("status", LeadStatus.DISCOVERED.value)
        .is_("phone", "null")
        .execute()
    )
    rejected = len(r.data or [])

    return {"qualified": qualified, "rejected": rejected}
