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
