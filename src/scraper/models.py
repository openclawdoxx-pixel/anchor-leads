from datetime import date
from enum import Enum
from typing import Any
from uuid import UUID
from pydantic import BaseModel, Field

class LeadStatus(str, Enum):
    DISCOVERED = "discovered"
    QUALIFIED = "qualified"
    REJECTED = "rejected"
    ENRICHED = "enriched"
    ENRICHMENT_FAILED = "enrichment_failed"
    SCORED = "scored"

class BestPitch(str, Enum):
    WEBSITE = "website"
    MCB = "mcb"
    CHAT_AI = "chat_ai"
    REPUTATION = "reputation"
    GHL_CRM = "ghl_crm"

class BookingPathQuality(str, Enum):
    STRONG = "strong"
    WEAK = "weak"
    NONE = "none"

class Lead(BaseModel):
    id: UUID | None = None
    overture_id: str | None = None
    place_id: str | None = None
    company_name: str
    phone: str | None = None
    website: str | None = None
    address: str | None = None
    city: str | None = None
    state: str
    lat: float | None = None
    lng: float | None = None
    status: LeadStatus = LeadStatus.DISCOVERED

class LeadEnrichment(BaseModel):
    lead_id: UUID
    owner_name: str | None = None
    review_count: int | None = None
    rating: float | None = None
    site_builder: str | None = None
    has_chat_widget: bool | None = None
    chat_widget_vendor: str | None = None
    has_ai_signals: bool | None = None
    last_site_update_year: int | None = None
    hero_snapshot: dict[str, Any] | None = None
    booking_path_quality: BookingPathQuality | None = None
    facebook_url: str | None = None
    facebook_last_post: date | None = None
    review_samples: list[dict[str, Any]] = Field(default_factory=list)
    raw_site_text: str | None = None

class LeadNotes(BaseModel):
    lead_id: UUID
    attack_angles: list[str]
    review_themes: list[str]
    digital_maturity: int = Field(ge=1, le=10)
    ai_summary: str
    best_pitch: BestPitch
