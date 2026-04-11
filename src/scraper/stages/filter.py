import re
from scraper.db import Database
from scraper.models import LeadStatus

# Known big-brand franchises + big-box plumbing chains — reject by name pattern
# (case-insensitive substring match). Add as you discover more.
FRANCHISE_PATTERNS = [
    r"roto[- ]?rooter",
    r"mr\.?\s*rooter",
    r"benjamin franklin plumb",
    r"horizon services",
    r"ars\b|rescue rooter",
    r"one hour\b",          # "One Hour Heating & Air"
    r"mr\.?\s*plumber",
    r"len the plumber",
    r"michael & son",
    r"aptera",
    r"len\s*the\s*plumber",
    r"home depot",
    r"lowe'?s",
    r"plumber near me llc",  # spammy lead-gen shells
    r"\bservice experts\b",
    r"\bwind river\b",
    r"\bmr\.?\s*handyman\b",
]

COMPILED_FRANCHISE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in FRANCHISE_PATTERNS]


def is_franchise(company_name: str) -> bool:
    return any(p.search(company_name) for p in COMPILED_FRANCHISE_PATTERNS)


def run_filter(db: Database) -> dict[str, int]:
    """Apply stage-2 ICP filter: must have phone, must not be a known franchise."""
    client = db.client

    # Fetch all discovered leads so we can name-filter in Python
    discovered = (
        client.table("leads")
        .select("id, company_name, phone")
        .eq("status", LeadStatus.DISCOVERED.value)
        .execute()
    ).data or []

    qualified_ids: list[str] = []
    rejected_ids: list[str] = []
    for row in discovered:
        if not row.get("phone"):
            rejected_ids.append(row["id"])
            continue
        if is_franchise(row.get("company_name", "")):
            rejected_ids.append(row["id"])
            continue
        qualified_ids.append(row["id"])

    # Apply updates in batches of 500 to avoid URL length limits
    def _batch_update(ids: list[str], new_status: str) -> None:
        for i in range(0, len(ids), 500):
            batch = ids[i : i + 500]
            if batch:
                client.table("leads").update({"status": new_status}).in_("id", batch).execute()

    _batch_update(qualified_ids, LeadStatus.QUALIFIED.value)
    _batch_update(rejected_ids, LeadStatus.REJECTED.value)

    return {"qualified": len(qualified_ids), "rejected": len(rejected_ids)}
