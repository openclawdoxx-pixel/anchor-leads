import re
from collections import defaultdict
from scraper.db import Database
from scraper.models import LeadStatus

# Franchise patterns — reject by name. Covers plumber + electrician chains.
FRANCHISE_PATTERNS = [
    # Plumber franchises
    r"roto[- ]?rooter",
    r"mr\.?\s*rooter",
    r"benjamin franklin plumb",
    r"horizon services",
    r"ars\b|rescue rooter",
    r"one hour\b",
    r"mr\.?\s*plumber",
    r"len the plumber",
    r"michael & son",
    r"aptera",
    r"home depot",
    r"lowe'?s",
    r"plumber near me llc",
    r"\bservice experts\b",
    r"\bwind river\b",
    r"\bmr\.?\s*handyman\b",
    r"\bzoom drain\b",
    r"\bz\s*plumberz\b",
    r"\bus home services\b",
    r"\bsuperior plumbing\b",
    r"\beyebytes\b",
    # Electrician franchises
    r"\bmr\.?\s*electric\b",
    r"\bmister\s*sparky\b",
    r"\barc\s*angel\s*electric\b",
    r"\byellow\s*jacket\s*electric\b",
    r"\bservice\s*champions\b",
    r"\bbaker\s*electric\b",
]

COMPILED_FRANCHISE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in FRANCHISE_PATTERNS]


def _normalize_phone(p: str | None) -> str | None:
    if not p:
        return None
    digits = re.sub(r'\D', '', p)
    return digits[-10:] if len(digits) >= 10 else None


def _normalize_website(w: str | None) -> str | None:
    if not w:
        return None
    return w.lower().replace('http://', '').replace('https://', '').replace('www.', '').rstrip('/')


def is_franchise(company_name: str) -> bool:
    return any(p.search(company_name) for p in COMPILED_FRANCHISE_PATTERNS)


def run_filter(db: Database) -> dict[str, int]:
    """Stage-2 ICP filter: phone required, no franchises, auto-dedup by phone+website."""
    client = db.client

    # Fetch all discovered leads
    all_discovered: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("leads")
            .select("id, company_name, phone, website")
            .eq("status", LeadStatus.DISCOVERED.value)
            .range(offset, offset + 999)
            .execute()
        ).data or []
        if not batch:
            break
        all_discovered.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    qualified_ids: list[str] = []
    rejected_ids: list[str] = []

    for row in all_discovered:
        if not row.get("phone"):
            rejected_ids.append(row["id"])
            continue
        if is_franchise(row.get("company_name", "")):
            rejected_ids.append(row["id"])
            continue
        qualified_ids.append(row["id"])

    # --- AUTO DEDUP within this batch ---
    # Also check against ALL existing non-rejected leads for phone/website collisions
    existing = []
    offset = 0
    while True:
        batch = (
            client.table("leads")
            .select("id, phone, website")
            .neq("status", "rejected")
            .neq("status", "discovered")
            .range(offset, offset + 999)
            .execute()
        ).data or []
        if not batch:
            break
        existing.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    seen_phones: set[str] = set()
    seen_websites: set[str] = set()
    for row in existing:
        np = _normalize_phone(row.get("phone"))
        if np:
            seen_phones.add(np)
        nw = _normalize_website(row.get("website"))
        if nw:
            seen_websites.add(nw)

    # Filter qualified_ids for dupes
    deduped_qualified: list[str] = []
    duped_ids: list[str] = []

    # We need phone/website for the qualified rows — re-fetch them
    qual_data = {row["id"]: row for row in all_discovered if row["id"] in set(qualified_ids)}

    for qid in qualified_ids:
        row = qual_data.get(qid)
        if not row:
            deduped_qualified.append(qid)
            continue
        np = _normalize_phone(row.get("phone"))
        nw = _normalize_website(row.get("website"))

        is_dupe = False
        if np and np in seen_phones:
            is_dupe = True
        if nw and nw in seen_websites:
            is_dupe = True

        if is_dupe:
            duped_ids.append(qid)
        else:
            deduped_qualified.append(qid)
            if np:
                seen_phones.add(np)
            if nw:
                seen_websites.add(nw)

    def _batch_update(ids: list[str], new_status: str) -> None:
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            if chunk:
                client.table("leads").update({"status": new_status}).in_("id", chunk).execute()

    _batch_update(deduped_qualified, LeadStatus.QUALIFIED.value)
    _batch_update(rejected_ids, LeadStatus.REJECTED.value)

    # Delete pure dupes instead of keeping them as rejected clutter
    for i in range(0, len(duped_ids), 500):
        chunk = duped_ids[i : i + 500]
        if chunk:
            client.table("leads").delete().in_("id", chunk).execute()

    return {
        "qualified": len(deduped_qualified),
        "rejected": len(rejected_ids),
        "dupes_deleted": len(duped_ids),
    }
