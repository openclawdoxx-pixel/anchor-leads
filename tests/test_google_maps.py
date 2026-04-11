from pathlib import Path
from scraper.enrichment.google_maps import parse_listing

def test_parse_listing_extracts_rating_and_review_count():
    html = Path("tests/fixtures/sites/gmaps_listing.html").read_text()
    result = parse_listing(html)
    assert result["rating"] == 4.6
    assert result["review_count"] == 42
    assert result["place_id"] == "0x89c25855b5d1f5c7:0x8a8b8c8d8e8f9091"
    assert len(result["review_samples"]) >= 1
    assert isinstance(result["review_samples"], list)
