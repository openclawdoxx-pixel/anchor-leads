# Plumber Lead Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a four-stage Python CLI (`discover → filter → enrich → score`) that populates a Supabase database with ICP-qualified US plumber leads, each scored with a structured sales-intel JSON.

**Architecture:** Four independent, idempotent stages keyed off `leads.status`. Stage 1 queries the Overture Maps open dataset via DuckDB (no scraping). Stage 2 applies pure-SQL ICP filters. Stage 3 uses Playwright (matching gstack's stealth approach) to fetch each lead's website and Google Maps listing for enrichment. Stage 4 runs an Anthropic Haiku 4.5 LLM pass to produce the `lead_notes` JSON. Every stage can be run, resumed, and re-run independently.

**Tech Stack:** Python 3.11+, DuckDB (Overture parquet), supabase-py, Playwright (stealth), httpx + BeautifulSoup, anthropic SDK, typer (CLI), pydantic (models), pytest (tests), python-dotenv (config).

**Spec:** `docs/superpowers/specs/2026-04-10-plumber-lead-scraper-design.md`

---

## File Structure

```
anchor-leads/
├── .env.example
├── .gitignore
├── pyproject.toml
├── README.md
├── migrations/
│   ├── 001_leads.sql
│   ├── 002_lead_enrichment.sql
│   ├── 003_lead_notes.sql
│   └── 004_scraper_runs.sql
├── prompts/
│   └── score_lead.md
├── src/scraper/
│   ├── __init__.py
│   ├── cli.py                  # typer entry point (4 subcommands)
│   ├── config.py               # env loading
│   ├── db.py                   # supabase client + query helpers
│   ├── models.py               # pydantic models
│   ├── browser.py              # shared playwright context + stealth
│   ├── llm.py                  # anthropic client wrapper
│   ├── stages/
│   │   ├── __init__.py
│   │   ├── discover.py         # Overture → leads insert
│   │   ├── filter.py           # ICP SQL filter
│   │   ├── enrich.py           # orchestrates enrichment subtasks
│   │   └── score.py            # LLM scoring
│   └── enrichment/
│       ├── __init__.py
│       ├── website.py          # site builder, chat widget, hero, booking path
│       ├── google_maps.py      # place_id, reviews, rating
│       ├── owner.py            # owner-name lookup chain
│       └── facebook.py         # facebook page + last post date
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── fixtures/
    │   ├── sites/              # saved HTML from real plumber sites
    │   └── overture_sample.json
    ├── test_config.py
    ├── test_models.py
    ├── test_db.py
    ├── test_discover.py
    ├── test_filter.py
    ├── test_website.py
    ├── test_google_maps.py
    ├── test_owner.py
    ├── test_facebook.py
    ├── test_enrich.py
    ├── test_score.py
    └── test_cli.py
```

Each file has a single clear responsibility. `stages/` owns pipeline control flow; `enrichment/` owns the "what signals to extract" logic. The split means the enrichment functions can be unit-tested against saved HTML fixtures without touching Supabase or the network.

---

## Task 0: Project Scaffolding

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `.env.example`, `README.md`, `src/scraper/__init__.py`, `tests/__init__.py`, `tests/conftest.py`

- [ ] **Step 1: Initialize git and create scaffold directories**

```bash
cd /Users/projectatlas/projects/anchor-leads
git init
mkdir -p src/scraper/stages src/scraper/enrichment tests/fixtures/sites migrations prompts
touch src/scraper/__init__.py src/scraper/stages/__init__.py src/scraper/enrichment/__init__.py tests/__init__.py
```

- [ ] **Step 2: Write pyproject.toml**

Create `pyproject.toml`:

```toml
[project]
name = "anchor-leads"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "typer>=0.12",
    "pydantic>=2.7",
    "python-dotenv>=1.0",
    "supabase>=2.5",
    "duckdb>=1.0",
    "playwright>=1.44",
    "httpx>=0.27",
    "beautifulsoup4>=4.12",
    "anthropic>=0.34",
    "tenacity>=8.3",
]

[project.optional-dependencies]
dev = ["pytest>=8.2", "pytest-asyncio>=0.23", "pytest-mock>=3.14", "respx>=0.21"]

[project.scripts]
scraper = "scraper.cli:app"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 3: Write .gitignore**

```
.env
.venv/
__pycache__/
*.pyc
.pytest_cache/
dist/
build/
*.egg-info/
.DS_Store
data/
```

- [ ] **Step 4: Write .env.example**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 5: Write minimal README.md**

```markdown
# anchor-leads

Plumber lead scraper + enrichment pipeline feeding Supabase.

## Setup

1. `python -m venv .venv && source .venv/bin/activate`
2. `pip install -e ".[dev]"`
3. `playwright install chromium`
4. Copy `.env.example` to `.env` and fill in Supabase + Anthropic keys
5. Run migrations: `psql "$SUPABASE_DB_URL" -f migrations/001_leads.sql` (repeat for 002-004)
6. `scraper discover --state NY`

See `docs/superpowers/specs/` for the full design.
```

- [ ] **Step 6: Install dependencies and verify**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium
pytest --collect-only
```

Expected: pytest runs cleanly with 0 tests collected (no errors).

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: initial project scaffold"
```

---

## Task 1: Database Migrations

**Files:**
- Create: `migrations/001_leads.sql`, `migrations/002_lead_enrichment.sql`, `migrations/003_lead_notes.sql`, `migrations/004_scraper_runs.sql`

- [ ] **Step 1: Write migrations/001_leads.sql**

```sql
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  overture_id     text unique,
  place_id        text unique,
  company_name    text not null,
  phone           text,
  website         text,
  address         text,
  city            text,
  state           text not null,
  lat             double precision,
  lng             double precision,
  status          text not null default 'discovered',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_state_idx on leads (state);
```

- [ ] **Step 2: Write migrations/002_lead_enrichment.sql**

```sql
create table if not exists lead_enrichment (
  lead_id                uuid primary key references leads(id) on delete cascade,
  owner_name             text,
  review_count           int,
  rating                 float,
  site_builder           text,
  has_chat_widget        boolean,
  chat_widget_vendor     text,
  has_ai_signals         boolean,
  last_site_update_year  int,
  hero_snapshot          jsonb,
  booking_path_quality   text,
  facebook_url           text,
  facebook_last_post     date,
  review_samples         jsonb,
  raw_site_text          text,
  enriched_at            timestamptz not null default now()
);
```

- [ ] **Step 3: Write migrations/003_lead_notes.sql**

```sql
create table if not exists lead_notes (
  lead_id          uuid primary key references leads(id) on delete cascade,
  attack_angles    jsonb,
  review_themes    jsonb,
  digital_maturity int,
  ai_summary       text,
  best_pitch       text,
  scored_at        timestamptz not null default now()
);
```

- [ ] **Step 4: Write migrations/004_scraper_runs.sql**

```sql
create table if not exists scraper_runs (
  id         uuid primary key default gen_random_uuid(),
  stage      text not null,
  state      text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  processed  int default 0,
  succeeded  int default 0,
  failed     int default 0,
  notes      text
);
```

- [ ] **Step 5: Apply migrations in Supabase**

User action: paste each migration into Supabase SQL Editor and run. No automated step — Supabase doesn't expose psql from `SUPABASE_URL` alone.

- [ ] **Step 6: Commit**

```bash
git add migrations/
git commit -m "feat: add database migrations for leads, enrichment, notes, runs"
```

---

## Task 2: Config Loading

**Files:**
- Create: `src/scraper/config.py`, `tests/test_config.py`

- [ ] **Step 1: Write the failing test**

`tests/test_config.py`:

```python
import os
import pytest
from scraper.config import Config, load_config

def test_load_config_reads_required_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc_key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    cfg = load_config()
    assert cfg.supabase_url == "https://x.supabase.co"
    assert cfg.supabase_service_role_key == "svc_key"
    assert cfg.anthropic_api_key == "sk-ant-test"

def test_load_config_raises_on_missing(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        load_config()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_config.py -v
```

Expected: ImportError — `scraper.config` doesn't exist.

- [ ] **Step 3: Write src/scraper/config.py**

```python
import os
from dataclasses import dataclass
from dotenv import load_dotenv

@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_role_key: str
    anthropic_api_key: str

def load_config() -> Config:
    load_dotenv()
    required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")
    return Config(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_config.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/config.py tests/test_config.py
git commit -m "feat: add config loader with required env validation"
```

---

## Task 3: Pydantic Models

**Files:**
- Create: `src/scraper/models.py`, `tests/test_models.py`

- [ ] **Step 1: Write the failing test**

`tests/test_models.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_models.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/models.py**

```python
from datetime import date, datetime
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_models.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/models.py tests/test_models.py
git commit -m "feat: add pydantic models for lead, enrichment, notes"
```

---

## Task 4: Supabase DB Wrapper

**Files:**
- Create: `src/scraper/db.py`, `tests/test_db.py`

- [ ] **Step 1: Write the failing test**

`tests/test_db.py`:

```python
from unittest.mock import MagicMock, patch
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
    mock_client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"id": str(uuid4()), "company_name": "Acme", "state": "NY", "status": "qualified"}
    ]
    db = Database(client=mock_client)
    leads = db.fetch_leads_by_status(LeadStatus.QUALIFIED, limit=10)
    assert len(leads) == 1
    assert leads[0].company_name == "Acme"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_db.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/db.py**

```python
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
        self.client.table("leads").upsert(payload, on_conflict="overture_id").execute()

    def fetch_leads_by_status(self, status: LeadStatus, limit: int = 500) -> list[Lead]:
        resp = (
            self.client.table("leads")
            .select("*")
            .eq("status", status.value)
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_db.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/db.py tests/test_db.py
git commit -m "feat: add Supabase database wrapper with typed queries"
```

---

## Task 5: Discover Stage (Overture Maps via DuckDB)

**Files:**
- Create: `src/scraper/stages/discover.py`, `tests/test_discover.py`, `tests/fixtures/overture_sample.json`

Overture publishes parquet files on S3. DuckDB can query them directly with the spatial extension — no local download of the full dataset needed. We filter by category (plumber) and US state bbox.

- [ ] **Step 1: Create fixture**

`tests/fixtures/overture_sample.json`:

```json
[
  {
    "id": "ovt-1",
    "names": {"primary": "Acme Plumbing"},
    "categories": {"primary": "plumber"},
    "phones": ["+15555551234"],
    "websites": ["https://acmeplumbing.com"],
    "addresses": [{"locality": "Buffalo", "region": "NY", "freeform": "123 Main St"}],
    "geometry": {"type": "Point", "coordinates": [-78.87, 42.88]}
  },
  {
    "id": "ovt-2",
    "names": {"primary": "Best Pipes LLC"},
    "categories": {"primary": "plumber"},
    "phones": [],
    "websites": [],
    "addresses": [{"locality": "Albany", "region": "NY", "freeform": "45 Elm"}],
    "geometry": {"type": "Point", "coordinates": [-73.76, 42.65]}
  }
]
```

- [ ] **Step 2: Write the failing test**

`tests/test_discover.py`:

```python
import json
from pathlib import Path
from unittest.mock import MagicMock
from scraper.stages.discover import parse_overture_row, run_discover
from scraper.models import Lead, LeadStatus

def test_parse_overture_row_maps_fields():
    sample = json.loads(Path("tests/fixtures/overture_sample.json").read_text())
    lead = parse_overture_row(sample[0], state="NY")
    assert lead.company_name == "Acme Plumbing"
    assert lead.overture_id == "ovt-1"
    assert lead.phone == "+15555551234"
    assert lead.website == "https://acmeplumbing.com"
    assert lead.city == "Buffalo"
    assert lead.state == "NY"
    assert lead.lat == 42.88
    assert lead.lng == -78.87

def test_parse_overture_row_handles_missing_phone_and_website():
    sample = json.loads(Path("tests/fixtures/overture_sample.json").read_text())
    lead = parse_overture_row(sample[1], state="NY")
    assert lead.phone is None
    assert lead.website is None

def test_run_discover_upserts_all_rows():
    sample = json.loads(Path("tests/fixtures/overture_sample.json").read_text())
    mock_db = MagicMock()
    run_discover(state="NY", rows=sample, db=mock_db)
    assert mock_db.upsert_lead.call_count == 2
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_discover.py -v
```

Expected: ImportError.

- [ ] **Step 4: Write src/scraper/stages/discover.py**

```python
from typing import Any, Iterable
import duckdb
from scraper.db import Database
from scraper.models import Lead, LeadStatus

OVERTURE_PLACES_URL = (
    "s3://overturemaps-us-west-2/release/2025-01-22.0/theme=places/type=place/*"
)

STATE_BBOXES: dict[str, tuple[float, float, float, float]] = {
    # (min_lng, min_lat, max_lng, max_lat)
    "NY": (-79.76, 40.49, -71.85, 45.02),
    "PA": (-80.52, 39.71, -74.69, 42.27),
    "NJ": (-75.56, 38.93, -73.88, 41.36),
    "CT": (-73.73, 40.98, -71.78, 42.05),
    "MA": (-73.51, 41.23, -69.93, 42.89),
    "RI": (-71.89, 41.14, -71.12, 42.02),
    "VT": (-73.44, 42.72, -71.46, 45.02),
    "NH": (-72.56, 42.70, -70.61, 45.31),
    "ME": (-71.08, 43.06, -66.95, 47.46),
}

PLUMBER_CATEGORIES = {"plumber", "plumbing", "plumbing_service", "plumbing_contractor"}

def parse_overture_row(row: dict[str, Any], state: str) -> Lead:
    names = row.get("names") or {}
    phones = row.get("phones") or []
    websites = row.get("websites") or []
    addresses = row.get("addresses") or [{}]
    addr = addresses[0] if addresses else {}
    geom = row.get("geometry") or {}
    coords = geom.get("coordinates") or [None, None]
    return Lead(
        overture_id=row.get("id"),
        company_name=names.get("primary") or "Unknown",
        phone=phones[0] if phones else None,
        website=websites[0] if websites else None,
        address=addr.get("freeform"),
        city=addr.get("locality"),
        state=state,
        lng=coords[0],
        lat=coords[1],
        status=LeadStatus.DISCOVERED,
    )

def query_overture(state: str) -> list[dict[str, Any]]:
    """Query Overture Maps parquet for plumber POIs in a state's bounding box."""
    if state not in STATE_BBOXES:
        raise ValueError(f"No bbox for state {state}")
    min_lng, min_lat, max_lng, max_lat = STATE_BBOXES[state]
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    categories_list = "', '".join(PLUMBER_CATEGORIES)
    sql = f"""
        SELECT
          id,
          names,
          categories,
          phones,
          websites,
          addresses,
          ST_AsGeoJSON(geometry) AS geometry_json
        FROM read_parquet('{OVERTURE_PLACES_URL}', hive_partitioning=1)
        WHERE bbox.xmin >= {min_lng} AND bbox.xmax <= {max_lng}
          AND bbox.ymin >= {min_lat} AND bbox.ymax <= {max_lat}
          AND categories.primary IN ('{categories_list}')
    """
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    result = []
    import json as _json
    for r in rows:
        d = dict(zip(cols, r))
        d["geometry"] = _json.loads(d.pop("geometry_json"))
        result.append(d)
    return result

def run_discover(state: str, db: Database, rows: Iterable[dict[str, Any]] | None = None) -> int:
    if rows is None:
        rows = query_overture(state)
    count = 0
    for row in rows:
        try:
            lead = parse_overture_row(row, state=state)
            db.upsert_lead(lead)
            count += 1
        except Exception as e:
            print(f"[discover] skip row {row.get('id')}: {e}")
    return count
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_discover.py -v
```

Expected: 3 tests PASS. (`query_overture` is not tested here; it's an integration point tested manually with the real Overture dataset.)

- [ ] **Step 6: Commit**

```bash
git add src/scraper/stages/discover.py tests/test_discover.py tests/fixtures/overture_sample.json
git commit -m "feat: add discover stage querying Overture Maps via DuckDB"
```

---

## Task 6: Filter Stage (ICP SQL)

**Files:**
- Create: `src/scraper/stages/filter.py`, `tests/test_filter.py`

Only the state + has-phone check runs here (pre-enrichment). Review count, website quality, and booking-path filters run at the end of Stage 3 because they require fetched data.

- [ ] **Step 1: Write the failing test**

`tests/test_filter.py`:

```python
from unittest.mock import MagicMock
from scraper.stages.filter import run_filter

def test_run_filter_marks_leads_without_phone_rejected():
    mock_db = MagicMock()
    mock_db.client.rpc.return_value.execute.return_value = None
    run_filter(db=mock_db)
    # Two SQL updates expected: qualify + reject
    assert mock_db.client.rpc.call_count == 0  # uses .table().update() not rpc
    calls = mock_db.client.table.call_args_list
    assert any(call.args[0] == "leads" for call in calls)
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_filter.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/stages/filter.py**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_filter.py -v
```

Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/stages/filter.py tests/test_filter.py
git commit -m "feat: add filter stage applying pre-enrichment ICP rules"
```

---

## Task 7: Browser Module (shared Playwright context)

**Files:**
- Create: `src/scraper/browser.py`

No unit test — this is a thin wrapper that exists for shared state. Integration-tested via the enrichment tasks that use it.

- [ ] **Step 1: Write src/scraper/browser.py**

```python
from contextlib import asynccontextmanager
from typing import AsyncIterator
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
import random
import asyncio

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
]

@asynccontextmanager
async def browser_context() -> AsyncIterator[BrowserContext]:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        context = await browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1366, "height": 900},
            locale="en-US",
        )
        # Strip the webdriver flag to reduce bot detection
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        try:
            yield context
        finally:
            await browser.close()

async def polite_wait(min_s: float = 2.0, max_s: float = 6.0) -> None:
    await asyncio.sleep(random.uniform(min_s, max_s))

async def fetch_page_html(context: BrowserContext, url: str, timeout_ms: int = 20000) -> str:
    page: Page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        await page.wait_for_timeout(1500)
        return await page.content()
    finally:
        await page.close()
```

- [ ] **Step 2: Commit**

```bash
git add src/scraper/browser.py
git commit -m "feat: add shared playwright browser context with stealth"
```

---

## Task 8: Website Enrichment (site builder, chat widget, hero, booking)

**Files:**
- Create: `src/scraper/enrichment/website.py`, `tests/test_website.py`, `tests/fixtures/sites/wix_no_chat.html`, `tests/fixtures/sites/wordpress_with_intercom.html`, `tests/fixtures/sites/weak_hero.html`, `tests/fixtures/sites/strong_hero.html`

- [ ] **Step 1: Create HTML fixtures**

`tests/fixtures/sites/wix_no_chat.html`:

```html
<!DOCTYPE html>
<html><head>
<meta name="generator" content="Wix.com Website Builder">
<title>Bob's Plumbing</title>
</head><body>
<header><h1>Welcome to Bob's Plumbing</h1><p>Learn about us.</p></header>
<footer>© 2019 Bob's Plumbing</footer>
</body></html>
```

`tests/fixtures/sites/wordpress_with_intercom.html`:

```html
<!DOCTYPE html>
<html><head>
<meta name="generator" content="WordPress 6.5">
<title>Ace Plumbers</title>
<script src="https://widget.intercom.io/widget/abc123"></script>
</head><body>
<header><h1>24/7 Emergency Plumbing</h1><a href="tel:5551234567">Call Now: 555-123-4567</a></header>
<footer>© 2024 Ace Plumbers</footer>
</body></html>
```

`tests/fixtures/sites/weak_hero.html`:

```html
<!DOCTYPE html>
<html><head><title>Joe Plumber</title></head><body>
<header><h1>Joe Plumber</h1><p>We do plumbing. Contact us for more information.</p></header>
</body></html>
```

`tests/fixtures/sites/strong_hero.html`:

```html
<!DOCTYPE html>
<html><head><title>Fast Plumbers</title></head><body>
<header>
  <h1>Emergency Plumber — On The Way in 60 Minutes</h1>
  <a href="tel:5551234567" class="cta">Call (555) 123-4567</a>
  <form action="/book"><input type="text" name="name"/><button>Book Online</button></form>
</header>
</body></html>
```

- [ ] **Step 2: Write the failing test**

`tests/test_website.py`:

```python
from pathlib import Path
from scraper.enrichment.website import (
    analyze_html, detect_site_builder, detect_chat_widget,
    extract_hero_snapshot, score_booking_path, extract_last_update_year,
)
from scraper.models import BookingPathQuality

def _load(name: str) -> str:
    return Path(f"tests/fixtures/sites/{name}").read_text()

def test_detect_wix():
    assert detect_site_builder(_load("wix_no_chat.html")) == "wix"

def test_detect_wordpress():
    assert detect_site_builder(_load("wordpress_with_intercom.html")) == "wordpress"

def test_detect_intercom_widget():
    vendor = detect_chat_widget(_load("wordpress_with_intercom.html"))
    assert vendor == "intercom"

def test_no_widget_on_wix_site():
    assert detect_chat_widget(_load("wix_no_chat.html")) is None

def test_extract_last_update_year():
    assert extract_last_update_year(_load("wix_no_chat.html")) == 2019
    assert extract_last_update_year(_load("wordpress_with_intercom.html")) == 2024

def test_weak_hero_snapshot():
    snap = extract_hero_snapshot(_load("weak_hero.html"))
    assert snap["has_phone_link"] is False
    assert snap["has_booking_form"] is False
    assert score_booking_path(snap) == BookingPathQuality.NONE

def test_strong_hero_snapshot():
    snap = extract_hero_snapshot(_load("strong_hero.html"))
    assert snap["has_phone_link"] is True
    assert snap["has_booking_form"] is True
    assert score_booking_path(snap) == BookingPathQuality.STRONG

def test_analyze_html_end_to_end():
    result = analyze_html(_load("wordpress_with_intercom.html"))
    assert result["site_builder"] == "wordpress"
    assert result["chat_widget_vendor"] == "intercom"
    assert result["has_chat_widget"] is True
    assert result["last_site_update_year"] == 2024
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_website.py -v
```

Expected: ImportError.

- [ ] **Step 4: Write src/scraper/enrichment/website.py**

```python
import re
from typing import Any
from bs4 import BeautifulSoup
from scraper.models import BookingPathQuality

BUILDER_PATTERNS: list[tuple[str, str]] = [
    ("wix", r"wix\.com|wixsite|Wix\.com Website Builder"),
    ("wordpress", r"wp-content|wp-includes|WordPress\b"),
    ("godaddy", r"godaddy|gd-website|dpbolvw"),
    ("squarespace", r"squarespace|static1\.squarespace"),
    ("shopify", r"cdn\.shopify|shopify\.com"),
]

CHAT_VENDORS: list[tuple[str, str]] = [
    ("intercom", r"intercom\.io|widget\.intercom"),
    ("drift", r"drift\.com|js\.driftt"),
    ("tidio", r"tidio\.co|code\.tidio"),
    ("tawk", r"tawk\.to|embed\.tawk"),
    ("hubspot", r"hs-scripts|hubspot\.com/forms|messages\.hubspot"),
    ("gohighlevel", r"leadconnectorhq|gohighlevel"),
    ("zendesk", r"zdassets|zendesk\.com"),
]

AI_PATTERNS = r"\b(ai assistant|chatbot|powered by openai|claude|gpt-)\b"

def detect_site_builder(html: str) -> str:
    for name, pat in BUILDER_PATTERNS:
        if re.search(pat, html, re.IGNORECASE):
            return name
    return "custom"

def detect_chat_widget(html: str) -> str | None:
    for name, pat in CHAT_VENDORS:
        if re.search(pat, html, re.IGNORECASE):
            return name
    return None

def detect_ai_signals(html: str) -> bool:
    return bool(re.search(AI_PATTERNS, html, re.IGNORECASE))

def extract_last_update_year(html: str) -> int | None:
    m = re.search(r"©\s*(\d{4})", html)
    if m:
        return int(m.group(1))
    m = re.search(r"copyright\s*(?:&copy;)?\s*(\d{4})", html, re.IGNORECASE)
    return int(m.group(1)) if m else None

def extract_hero_snapshot(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    hero = soup.find("header") or soup.body or soup
    hero_text = " ".join((hero.get_text(" ", strip=True) or "").split())[:500]
    ctas: list[str] = []
    for a in hero.find_all("a"):
        text = a.get_text(strip=True)
        if text:
            ctas.append(text)
    has_phone_link = any(a.get("href", "").startswith("tel:") for a in hero.find_all("a"))
    has_booking_form = bool(hero.find("form"))
    return {
        "hero_text": hero_text,
        "above_fold_ctas": ctas[:8],
        "has_phone_link": has_phone_link,
        "has_booking_form": has_booking_form,
    }

def score_booking_path(snap: dict[str, Any]) -> BookingPathQuality:
    phone = snap.get("has_phone_link", False)
    form = snap.get("has_booking_form", False)
    if phone and form:
        return BookingPathQuality.STRONG
    if phone or form:
        return BookingPathQuality.WEAK
    return BookingPathQuality.NONE

def analyze_html(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    raw_text = soup.get_text(" ", strip=True)
    snap = extract_hero_snapshot(html)
    vendor = detect_chat_widget(html)
    return {
        "site_builder": detect_site_builder(html),
        "has_chat_widget": vendor is not None,
        "chat_widget_vendor": vendor,
        "has_ai_signals": detect_ai_signals(html),
        "last_site_update_year": extract_last_update_year(html),
        "hero_snapshot": snap,
        "booking_path_quality": score_booking_path(snap).value,
        "raw_site_text": raw_text[:20000],
    }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_website.py -v
```

Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/enrichment/website.py tests/test_website.py tests/fixtures/sites/
git commit -m "feat: add website analyzer for builder, chat, hero, booking-path"
```

---

## Task 9: Google Maps Enrichment

**Files:**
- Create: `src/scraper/enrichment/google_maps.py`, `tests/test_google_maps.py`

This is unavoidably browser-heavy. We unit test the parsing of a saved Google Maps listing HTML; the full search flow is integration-tested manually.

- [ ] **Step 1: Save a fixture**

Save any real Google Maps plumber listing HTML to `tests/fixtures/sites/gmaps_listing.html` during implementation. It should contain a rating, review count, and at least one review block.

- [ ] **Step 2: Write the failing test**

`tests/test_google_maps.py`:

```python
from pathlib import Path
from scraper.enrichment.google_maps import parse_listing

def test_parse_listing_extracts_rating_and_review_count():
    html = Path("tests/fixtures/sites/gmaps_listing.html").read_text()
    result = parse_listing(html)
    assert result["rating"] is not None
    assert isinstance(result["review_count"], int)
    assert isinstance(result["review_samples"], list)
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_google_maps.py -v
```

Expected: ImportError.

- [ ] **Step 4: Write src/scraper/enrichment/google_maps.py**

```python
import re
from typing import Any
from urllib.parse import quote_plus
from bs4 import BeautifulSoup
from playwright.async_api import BrowserContext
from scraper.browser import polite_wait

async def search_and_fetch(context: BrowserContext, company: str, city: str) -> str | None:
    query = quote_plus(f"{company} {city} plumber")
    url = f"https://www.google.com/maps/search/{query}"
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(2500)
        first_result = page.locator('a[href*="/maps/place/"]').first
        if await first_result.count() == 0:
            return None
        await first_result.click()
        await page.wait_for_timeout(3000)
        html = await page.content()
        return html
    finally:
        await page.close()
        await polite_wait()

def parse_listing(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    rating = None
    m = re.search(r'(\d\.\d)\s*(?:stars?|\([\d,]+\s*reviews?\))', html, re.IGNORECASE)
    if m:
        try:
            rating = float(m.group(1))
        except ValueError:
            pass
    review_count = None
    m = re.search(r'([\d,]+)\s*reviews?', html, re.IGNORECASE)
    if m:
        review_count = int(m.group(1).replace(",", ""))
    place_id = None
    m = re.search(r'!1s(0x[0-9a-f]+:0x[0-9a-f]+)', html)
    if m:
        place_id = m.group(1)
    # Review samples: pull visible review blocks (top 5)
    samples: list[dict[str, Any]] = []
    for block in soup.select('[data-review-id], [jsaction*="review"]')[:5]:
        text = block.get_text(" ", strip=True)[:500]
        if text:
            samples.append({"text": text})
    return {
        "place_id": place_id,
        "rating": rating,
        "review_count": review_count,
        "review_samples": samples,
    }

async def enrich_via_google(context: BrowserContext, company: str, city: str) -> dict[str, Any]:
    html = await search_and_fetch(context, company, city)
    if not html:
        return {"place_id": None, "rating": None, "review_count": None, "review_samples": []}
    return parse_listing(html)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_google_maps.py -v
```

Expected: 1 test PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/enrichment/google_maps.py tests/test_google_maps.py tests/fixtures/sites/gmaps_listing.html
git commit -m "feat: add Google Maps enrichment (rating, reviews, place id)"
```

---

## Task 10: Owner Name Lookup Chain

**Files:**
- Create: `src/scraper/enrichment/owner.py`, `tests/test_owner.py`

- [ ] **Step 1: Write the failing test**

`tests/test_owner.py`:

```python
from scraper.enrichment.owner import (
    extract_from_about_page, extract_from_review_text,
)

def test_extract_owner_from_about_page_meet():
    html = "<html><body><h2>Meet John Smith, our founder</h2></body></html>"
    assert extract_from_about_page(html) == "John Smith"

def test_extract_owner_from_about_page_owned_by():
    html = "<html><body><p>Owned and operated by Maria Garcia since 2010.</p></body></html>"
    assert extract_from_about_page(html) == "Maria Garcia"

def test_extract_owner_from_review():
    review = "The owner Bob came out himself and fixed our leak in an hour."
    assert extract_from_review_text(review) == "Bob"

def test_no_owner_found_returns_none():
    assert extract_from_about_page("<p>About our team</p>") is None
    assert extract_from_review_text("Great service, fast response") is None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_owner.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/enrichment/owner.py**

```python
import re
from typing import Any
from bs4 import BeautifulSoup
from playwright.async_api import BrowserContext

ABOUT_PATTERNS = [
    r"[Mm]eet\s+([A-Z][a-z]+\s+[A-Z][a-z]+)",
    r"(?:owner|founder|owned by|operated by|established by|founded by)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)",
    r"([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[-—,]\s*(?:owner|founder)",
]

REVIEW_PATTERNS = [
    r"(?:the\s+)?owner\s+([A-Z][a-z]+)",
    r"([A-Z][a-z]+)\s+the\s+owner",
]

def extract_from_about_page(html: str) -> str | None:
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    for pat in ABOUT_PATTERNS:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip()
    return None

def extract_from_review_text(text: str) -> str | None:
    for pat in REVIEW_PATTERNS:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip()
    return None

async def lookup_owner(
    context: BrowserContext,
    website: str | None,
    review_samples: list[dict[str, Any]],
) -> str | None:
    # 1. About page parse
    if website:
        from scraper.browser import fetch_page_html
        for path in ["/about", "/about-us", "/our-team", ""]:
            try:
                html = await fetch_page_html(context, website.rstrip("/") + path)
                name = extract_from_about_page(html)
                if name:
                    return name
            except Exception:
                continue
    # 2. Review scan
    for r in review_samples:
        name = extract_from_review_text(r.get("text", ""))
        if name:
            return name
    return None
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_owner.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/enrichment/owner.py tests/test_owner.py
git commit -m "feat: add owner name lookup chain (about page → reviews → fallback)"
```

---

## Task 11: Facebook Lookup

**Files:**
- Create: `src/scraper/enrichment/facebook.py`, `tests/test_facebook.py`

- [ ] **Step 1: Write the failing test**

`tests/test_facebook.py`:

```python
from datetime import date
from scraper.enrichment.facebook import extract_last_post_date

def test_extract_last_post_date_parses_relative():
    # FB uses "X days ago" / "X months ago" / dates
    html = '<abbr data-utime="1704067200">January 1, 2024</abbr>'
    d = extract_last_post_date(html)
    assert d == date(2024, 1, 1)

def test_extract_returns_none_when_no_date():
    assert extract_last_post_date("<html><body>no posts</body></html>") is None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_facebook.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/enrichment/facebook.py**

```python
import re
from datetime import date, datetime
from typing import Any
from playwright.async_api import BrowserContext
from scraper.browser import fetch_page_html

DATE_PATTERNS = [
    (r'data-utime="(\d+)"', lambda m: date.fromtimestamp(int(m.group(1)))),
    (r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})',
     lambda m: datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%B %d %Y").date()),
]

def extract_last_post_date(html: str) -> date | None:
    for pat, conv in DATE_PATTERNS:
        m = re.search(pat, html)
        if m:
            try:
                return conv(m)
            except Exception:
                continue
    return None

async def lookup_facebook(context: BrowserContext, company: str, city: str) -> dict[str, Any]:
    from urllib.parse import quote_plus
    query = quote_plus(f"{company} {city} plumber site:facebook.com")
    url = f"https://www.google.com/search?q={query}"
    try:
        html = await fetch_page_html(context, url)
    except Exception:
        return {"facebook_url": None, "facebook_last_post": None}
    m = re.search(r'https://(?:www\.|m\.)?facebook\.com/[^"\s<>]+', html)
    if not m:
        return {"facebook_url": None, "facebook_last_post": None}
    fb_url = m.group(0).split("&")[0]
    try:
        fb_html = await fetch_page_html(context, fb_url)
        last = extract_last_post_date(fb_html)
    except Exception:
        last = None
    return {"facebook_url": fb_url, "facebook_last_post": last}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_facebook.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/enrichment/facebook.py tests/test_facebook.py
git commit -m "feat: add facebook lookup for page URL and last-post date"
```

---

## Task 12: Enrich Stage Orchestrator

**Files:**
- Create: `src/scraper/stages/enrich.py`, `tests/test_enrich.py`

Orchestrates website + google + owner + facebook per lead, applies the final ICP filter, writes `lead_enrichment`, and updates `leads.status`.

- [ ] **Step 1: Write the failing test**

`tests/test_enrich.py`:

```python
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from scraper.stages.enrich import apply_final_icp, enrich_one
from scraper.models import Lead, LeadStatus, LeadEnrichment, BookingPathQuality

def test_apply_final_icp_rejects_over_100_reviews():
    e = LeadEnrichment(lead_id=uuid4(), review_count=150)
    assert apply_final_icp(e) is False

def test_apply_final_icp_accepts_small_shop_with_bad_site():
    e = LeadEnrichment(
        lead_id=uuid4(),
        review_count=15,
        site_builder="wix",
        has_chat_widget=False,
        booking_path_quality=BookingPathQuality.NONE,
    )
    assert apply_final_icp(e) is True

def test_apply_final_icp_rejects_modern_site_with_chat():
    e = LeadEnrichment(
        lead_id=uuid4(),
        review_count=20,
        site_builder="custom",
        has_chat_widget=True,
        last_site_update_year=2025,
        booking_path_quality=BookingPathQuality.STRONG,
    )
    assert apply_final_icp(e) is False

@pytest.mark.asyncio
async def test_enrich_one_writes_enrichment_and_updates_status():
    mock_db = MagicMock()
    mock_context = MagicMock()
    lead = Lead(id=uuid4(), company_name="Acme", state="NY", website=None, city="Buffalo", status=LeadStatus.QUALIFIED)

    # Patch out network calls
    import scraper.stages.enrich as mod
    mod.analyze_html = lambda _: {
        "site_builder": "none", "has_chat_widget": False, "chat_widget_vendor": None,
        "has_ai_signals": False, "last_site_update_year": None,
        "hero_snapshot": None, "booking_path_quality": "none", "raw_site_text": "",
    }
    mod.enrich_via_google = AsyncMock(return_value={
        "place_id": "x", "rating": 4.5, "review_count": 12, "review_samples": [],
    })
    mod.lookup_owner = AsyncMock(return_value="Bob")
    mod.lookup_facebook = AsyncMock(return_value={"facebook_url": None, "facebook_last_post": None})
    mod.fetch_page_html = AsyncMock(return_value="<html></html>")

    await enrich_one(lead, context=mock_context, db=mock_db)
    mock_db.upsert_enrichment.assert_called_once()
    mock_db.update_lead_status.assert_called_once()
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_enrich.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/stages/enrich.py**

```python
from uuid import UUID
from playwright.async_api import BrowserContext
from tenacity import retry, stop_after_attempt, wait_exponential
from scraper.db import Database
from scraper.models import Lead, LeadStatus, LeadEnrichment, BookingPathQuality
from scraper.browser import browser_context, fetch_page_html, polite_wait
from scraper.enrichment.website import analyze_html
from scraper.enrichment.google_maps import enrich_via_google
from scraper.enrichment.owner import lookup_owner
from scraper.enrichment.facebook import lookup_facebook

BAD_BUILDERS = {"wix", "godaddy", "none"}

def apply_final_icp(e: LeadEnrichment) -> bool:
    """Return True if lead passes full ICP after enrichment."""
    if e.review_count is not None and e.review_count >= 100:
        return False
    if e.has_chat_widget:
        return False
    # "bad website" positive signal — at least ONE must be true
    bad_signals = 0
    if e.site_builder in BAD_BUILDERS:
        bad_signals += 1
    if e.last_site_update_year and e.last_site_update_year <= 2023:
        bad_signals += 1
    if e.booking_path_quality in (BookingPathQuality.WEAK, BookingPathQuality.NONE):
        bad_signals += 1
    return bad_signals >= 1

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=16))
async def _fetch_site(context: BrowserContext, url: str) -> str:
    return await fetch_page_html(context, url)

async def enrich_one(lead: Lead, context: BrowserContext, db: Database) -> None:
    assert lead.id is not None
    site_data: dict = {}
    if lead.website:
        try:
            html = await _fetch_site(context, lead.website)
            site_data = analyze_html(html)
        except Exception as e:
            print(f"[enrich] site fetch failed for {lead.website}: {e}")

    gmaps = await enrich_via_google(context, lead.company_name, lead.city or lead.state)
    owner = await lookup_owner(context, lead.website, gmaps.get("review_samples", []))
    fb = await lookup_facebook(context, lead.company_name, lead.city or lead.state)

    booking_quality_raw = site_data.get("booking_path_quality")
    booking_quality = BookingPathQuality(booking_quality_raw) if booking_quality_raw else None

    enrichment = LeadEnrichment(
        lead_id=lead.id,
        owner_name=owner,
        review_count=gmaps.get("review_count"),
        rating=gmaps.get("rating"),
        site_builder=site_data.get("site_builder"),
        has_chat_widget=site_data.get("has_chat_widget"),
        chat_widget_vendor=site_data.get("chat_widget_vendor"),
        has_ai_signals=site_data.get("has_ai_signals"),
        last_site_update_year=site_data.get("last_site_update_year"),
        hero_snapshot=site_data.get("hero_snapshot"),
        booking_path_quality=booking_quality,
        facebook_url=fb.get("facebook_url"),
        facebook_last_post=fb.get("facebook_last_post"),
        review_samples=gmaps.get("review_samples", []),
        raw_site_text=site_data.get("raw_site_text"),
    )
    db.upsert_enrichment(enrichment)

    passed = apply_final_icp(enrichment)
    if not passed:
        db.update_lead_status(lead.id, LeadStatus.REJECTED)
    else:
        # Only update place_id if found
        if gmaps.get("place_id"):
            db.client.table("leads").update({"place_id": gmaps["place_id"]}).eq("id", str(lead.id)).execute()
        db.update_lead_status(lead.id, LeadStatus.ENRICHED)
    await polite_wait()

async def run_enrich(db: Database, limit: int = 500) -> dict[str, int]:
    leads = db.fetch_leads_by_status(LeadStatus.QUALIFIED, limit=limit)
    succeeded = failed = 0
    async with browser_context() as context:
        for lead in leads:
            try:
                await enrich_one(lead, context, db)
                succeeded += 1
            except Exception as e:
                print(f"[enrich] failed {lead.company_name}: {e}")
                if lead.id:
                    db.update_lead_status(lead.id, LeadStatus.ENRICHMENT_FAILED)
                failed += 1
    return {"processed": len(leads), "succeeded": succeeded, "failed": failed}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_enrich.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/stages/enrich.py tests/test_enrich.py
git commit -m "feat: add enrich stage orchestrating website + gmaps + owner + facebook"
```

---

## Task 13: LLM Wrapper + Scoring Prompt

**Files:**
- Create: `src/scraper/llm.py`, `prompts/score_lead.md`

- [ ] **Step 1: Write prompts/score_lead.md**

```markdown
# Plumber Lead Scoring Prompt

You are the sales-intelligence analyst for a lead-recovery offer sold to small US plumbing businesses.

## The Offer (5 pillars)

1. **website** — Full new website for plumbers with bad/no existing site.
2. **mcb** — Missed-call text-back: automatically SMS callers whose calls go unanswered.
3. **chat_ai** — Website chat widget and form entries pipe into SMS where a conversational AI handles the lead 24/7.
4. **reputation** — Reputation management: automated 5-star review requests after every job.
5. **ghl_crm** — GoHighLevel CRM setup (free — monetized per booked job at $75).

## Your Task

You will receive a JSON blob with everything we know about a plumbing business. Return a JSON object with:

- `attack_angles`: array of 2-5 short strings, each in the form `"<observation> → pitch <pillar>"`.
- `review_themes`: array of 0-5 short strings summarizing recurring complaints from reviews. Empty if no reviews.
- `digital_maturity`: integer 1-10. 1 = no online presence. 10 = modern, optimized, AI-enabled site with active social and reputation flywheel.
- `ai_summary`: ONE paragraph (2-4 sentences) a sales rep reads 5 seconds before dialing. Must include operation size, key weakness, and primary angle.
- `best_pitch`: exactly one of: `website`, `mcb`, `chat_ai`, `reputation`, `ghl_crm`. Pick the pillar that best solves their biggest visible weakness.

Return ONLY valid JSON. No prose, no markdown, no code fences.
```

- [ ] **Step 2: Write src/scraper/llm.py**

```python
import json
from pathlib import Path
from anthropic import Anthropic
from scraper.config import Config
from scraper.models import LeadNotes, BestPitch

PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "score_lead.md"

class LLMScorer:
    def __init__(self, config: Config):
        self.client = Anthropic(api_key=config.anthropic_api_key)
        self.system_prompt = PROMPT_PATH.read_text()
        self.model = "claude-haiku-4-5-20251001"

    def score(self, lead_id, enrichment_row: dict) -> LeadNotes:
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=self.system_prompt,
            messages=[{"role": "user", "content": json.dumps(enrichment_row, default=str)}],
        )
        text = resp.content[0].text.strip()
        if text.startswith("```"):
            text = text.strip("`").replace("json\n", "", 1)
        data = json.loads(text)
        return LeadNotes(
            lead_id=lead_id,
            attack_angles=data["attack_angles"],
            review_themes=data.get("review_themes", []),
            digital_maturity=int(data["digital_maturity"]),
            ai_summary=data["ai_summary"],
            best_pitch=BestPitch(data["best_pitch"]),
        )
```

- [ ] **Step 3: Commit**

```bash
git add src/scraper/llm.py prompts/score_lead.md
git commit -m "feat: add LLM scorer wrapper and scoring prompt"
```

---

## Task 14: Score Stage

**Files:**
- Create: `src/scraper/stages/score.py`, `tests/test_score.py`

- [ ] **Step 1: Write the failing test**

`tests/test_score.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_score.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/stages/score.py**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_score.py -v
```

Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/stages/score.py tests/test_score.py
git commit -m "feat: add score stage writing LLM-generated notes to Supabase"
```

---

## Task 15: CLI (typer)

**Files:**
- Create: `src/scraper/cli.py`, `tests/test_cli.py`

- [ ] **Step 1: Write the failing test**

`tests/test_cli.py`:

```python
from typer.testing import CliRunner
from scraper.cli import app

runner = CliRunner()

def test_cli_shows_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "discover" in result.stdout
    assert "filter" in result.stdout
    assert "enrich" in result.stdout
    assert "score" in result.stdout
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_cli.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write src/scraper/cli.py**

```python
import asyncio
import typer
from scraper.config import load_config
from scraper.db import Database
from scraper.stages.discover import run_discover
from scraper.stages.filter import run_filter
from scraper.stages.enrich import run_enrich
from scraper.stages.score import run_score
from scraper.llm import LLMScorer

app = typer.Typer(help="Anchor Leads — plumber lead scraper pipeline")

def _db() -> Database:
    return Database(config=load_config())

@app.command()
def discover(state: str = typer.Option(..., "--state", help="Two-letter state code, e.g. NY")):
    """Stage 1: pull plumber POIs from Overture Maps and insert into leads table."""
    db = _db()
    count = run_discover(state=state.upper(), db=db)
    db.log_run("discover", state.upper(), processed=count, succeeded=count, failed=0)
    typer.echo(f"discovered {count} leads in {state.upper()}")

@app.command()
def filter():
    """Stage 2: apply pre-enrichment ICP filter (phone + state)."""
    db = _db()
    result = run_filter(db=db)
    db.log_run("filter", None, processed=result["qualified"] + result["rejected"],
               succeeded=result["qualified"], failed=0,
               notes=f"rejected={result['rejected']}")
    typer.echo(f"qualified={result['qualified']} rejected={result['rejected']}")

@app.command()
def enrich(
    limit: int = typer.Option(500, "--limit"),
    loop: bool = typer.Option(False, "--loop", help="Run continuously until no qualified leads remain"),
):
    """Stage 3: enrich qualified leads (website + gmaps + owner + facebook)."""
    db = _db()
    while True:
        result = asyncio.run(run_enrich(db=db, limit=limit))
        db.log_run("enrich", None, **result)
        typer.echo(f"enriched: {result}")
        if not loop or result["processed"] == 0:
            break

@app.command()
def score(
    limit: int = typer.Option(500, "--limit"),
    loop: bool = typer.Option(False, "--loop"),
):
    """Stage 4: LLM-score enriched leads into sales-intel notes."""
    cfg = load_config()
    db = Database(config=cfg)
    scorer = LLMScorer(cfg)
    while True:
        result = run_score(db=db, scorer=scorer, limit=limit)
        db.log_run("score", None, **result)
        typer.echo(f"scored: {result}")
        if not loop or result["processed"] == 0:
            break

if __name__ == "__main__":
    app()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_cli.py -v
```

Expected: 1 test PASS.

- [ ] **Step 5: Run full test suite**

```bash
pytest -v
```

Expected: all tests green across all modules.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/cli.py tests/test_cli.py
git commit -m "feat: add typer CLI with discover/filter/enrich/score commands"
```

---

## Task 16: End-to-End Smoke Run (NY)

No new test code — this is manual verification that the whole stack works against real Supabase.

- [ ] **Step 1: Confirm `.env` has Supabase + Anthropic keys**

```bash
cat .env | grep -E "SUPABASE_URL|SUPABASE_SERVICE|ANTHROPIC"
```

- [ ] **Step 2: Verify Supabase migrations ran**

User action: in Supabase SQL Editor, run `select count(*) from leads;` — expect `0`.

- [ ] **Step 3: Run discover for NY**

```bash
source .venv/bin/activate
scraper discover --state NY
```

Expected: console prints `discovered N leads in NY` where N is a few thousand. Check Supabase: `select count(*) from leads where state = 'NY';` matches.

- [ ] **Step 4: Run filter**

```bash
scraper filter
```

Expected: most leads qualified, a small number rejected for missing phone.

- [ ] **Step 5: Run enrich on a small batch first**

```bash
scraper enrich --limit 10
```

Expected: 10 leads processed, some end up `enriched`, some `rejected` by final ICP, few `enrichment_failed`. Check Supabase `lead_enrichment` table is populated.

- [ ] **Step 6: Run score on the same small batch**

```bash
scraper score --limit 10
```

Expected: `lead_notes` populated with attack_angles, best_pitch, ai_summary for the enriched leads.

- [ ] **Step 7: Eyeball the result in Supabase Table Editor**

User action: open Supabase dashboard → Table Editor → `leads`, `lead_enrichment`, `lead_notes`. Read a few rows. Do the attack_angles make sense? Does the ai_summary read like useful sales intel?

- [ ] **Step 8: If quality is good, kick off the full background run**

```bash
scraper enrich --limit 500 --loop &
scraper score  --limit 500 --loop &
```

These run until no work remains. Re-run `scraper discover --state PA` tomorrow to add PA leads.

- [ ] **Step 9: Commit any prompt/code tweaks from eyeballing**

```bash
git add -A
git commit -m "tune: scoring prompt adjustments from NY smoke run"
```

---

## Self-Review

**Spec coverage:**
- Section 1 (Purpose) → covered by Tasks 0, 15
- Section 2 (ICP) → covered by Task 12 (`apply_final_icp`) and Task 6 (pre-filter)
- Section 3.1 (Discover/Overture) → Task 5
- Section 3.2 (Filter) → Task 6
- Section 3.3 (Enrich: website, gmaps, owner, facebook, hero/booking) → Tasks 7-12
- Section 3.4 (Score/LLM) → Tasks 13-14
- Section 4 (Schema) → Task 1
- Section 5 (CLI surface) → Task 15
- Section 6 (Error handling + resume) → Task 12 (retry + ENRICHMENT_FAILED), Task 15 (--loop), Task 4 (log_run)
- Section 7 (Secrets) → Tasks 0, 2
- Section 8 (What user sees tonight) → Task 16
- Section 9 (Out of scope) → respected — no CRM UI, no email, no dialer, no landing pages
- Section 10 (Phase 1.5) → explicitly deferred — not in this plan

**Placeholder scan:** no "TBD"/"TODO"/"implement later" in the plan. Fixtures in Task 9 require the engineer to save a real Google Maps HTML file during implementation — this is called out explicitly, not a placeholder.

**Type consistency:** `LeadStatus`, `BestPitch`, `BookingPathQuality` enums defined once in Task 3 and used consistently throughout Tasks 4-15. Database methods (`upsert_lead`, `fetch_leads_by_status`, `upsert_enrichment`, `upsert_notes`, `fetch_enrichment`, `update_lead_status`, `log_run`) defined in Task 4 and called with matching signatures in all later tasks.
