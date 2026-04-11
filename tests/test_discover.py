import json
from pathlib import Path
from unittest.mock import MagicMock
from scraper.stages.discover import parse_overture_row, run_discover

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
