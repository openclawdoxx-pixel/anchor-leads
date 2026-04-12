from scraper.enrichment.google_maps import parse_listing, _parse_review_count


def test_parse_listing_extracts_rating_and_review_count():
    data = {
        "html": '''<div role="main"><div aria-label="4.6 stars ">Rating</div>
        <a href="data=!1s0x89c25855b5d1f5c7:0x8a8b8c8d8e8f9091">link</a>
        <div data-review-id="r1">Great plumber Bob Smith the owner</div></div>''',
        "panel_text": "Acme Plumbing\n4.6(42)\nPlumber · 123 Main St",
    }
    result = parse_listing(data)
    assert result["rating"] == 4.6
    assert result["review_count"] == 42
    assert result["place_id"] == "0x89c25855b5d1f5c7:0x8a8b8c8d8e8f9091"
    assert len(result["review_samples"]) >= 1


def test_parse_review_count_with_k_suffix():
    assert _parse_review_count("Reimar Plumbing\n4.9(8.7K)\nPlumber") == 8700


def test_parse_review_count_plain():
    assert _parse_review_count("4.5(459)\nPlumber") == 459


def test_parse_review_count_none():
    assert _parse_review_count("No count here") is None
