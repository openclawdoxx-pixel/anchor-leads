from typing import Any
from uuid import UUID
from supabase import create_client, Client
from scraper.config import Config
from scraper.models import Lead, LeadEnrichment, LeadNotes, LeadStatus

class Database:
    def __init__(self, client: Client | None = None, config: Config | None = None):
        if client is None:
            assert config is not None, "Must pass client or config"
            client = create_client(config.supabase_url, config.supabase_service_role_key)
        self.client = client

    def upsert_lead(self, lead: Lead) -> None:
        payload = lead.model_dump(mode="json", exclude_none=True)
        # Don't overwrite status on existing leads — discover should never
        # reset an enriched/qualified/rejected lead back to "discovered".
        # Try insert first; if overture_id conflict, skip entirely.
        try:
            self.client.table("leads").insert(payload).execute()
        except Exception as e:
            if "duplicate key" in str(e) or "23505" in str(e):
                # Lead already exists — only update non-status fields
                update_payload = {k: v for k, v in payload.items() if k not in ("id", "status", "overture_id")}
                if update_payload and lead.overture_id:
                    self.client.table("leads").update(update_payload).eq("overture_id", lead.overture_id).execute()
            else:
                raise

    def fetch_leads_by_status(self, status: LeadStatus, limit: int = 500) -> list[Lead]:
        resp = (
            self.client.table("leads")
            .select("*")
            .eq("status", status.value)
            .order("website", desc=True, nullsfirst=False)
            .limit(limit)
            .execute()
        )
        return [Lead(**row) for row in resp.data]

    def update_lead_status(self, lead_id: UUID, status: LeadStatus) -> None:
        self.client.table("leads").update({"status": status.value}).eq("id", str(lead_id)).execute()

    def upsert_enrichment(self, enrichment: LeadEnrichment) -> None:
        payload = enrichment.model_dump(mode="json", exclude_none=True)
        self.client.table("lead_enrichment").upsert(payload).execute()

    def upsert_notes(self, notes: LeadNotes) -> None:
        payload = notes.model_dump(mode="json")
        self.client.table("lead_notes").upsert(payload).execute()

    def fetch_enrichment(self, lead_id: UUID) -> dict[str, Any] | None:
        resp = self.client.table("lead_enrichment").select("*").eq("lead_id", str(lead_id)).execute()
        return resp.data[0] if resp.data else None

    def log_run(self, stage: str, state: str | None, processed: int, succeeded: int, failed: int, notes: str = "") -> None:
        self.client.table("scraper_runs").insert({
            "stage": stage, "state": state, "processed": processed,
            "succeeded": succeeded, "failed": failed, "notes": notes,
            "ended_at": "now()",
        }).execute()
