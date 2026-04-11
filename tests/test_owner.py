from scraper.enrichment.owner import (
    extract_from_about_page, extract_from_review_text,
)


def test_extract_owner_from_about_page_meet():
    html = "<html><body><h2>Meet John Smith, our founder</h2></body></html>"
    assert extract_from_about_page(html) == "John Smith"


def test_extract_owner_from_about_page_owned_by():
    html = "<html><body><p>Owned and operated by Maria Garcia since 2010.</p></body></html>"
    assert extract_from_about_page(html) == "Maria Garcia"


def test_extract_owner_from_review_two_word():
    review = "The owner Bob Smith came out himself and fixed our leak."
    assert extract_from_review_text(review) == "Bob Smith"


def test_extract_owner_from_review_name_first():
    review = "Bob Smith, the owner, was very helpful."
    assert extract_from_review_text(review) == "Bob Smith"


def test_extract_owner_single_name_with_verb():
    review = "I called the owner, Robert, and he was great."
    assert extract_from_review_text(review) == "Robert"


def test_no_owner_found_returns_none():
    assert extract_from_about_page("<p>About our team</p>") is None
    assert extract_from_review_text("Great service, fast response") is None


def test_blacklist_filters_junk():
    # "owner Edited" shouldn't match — Edited is blacklisted
    assert extract_from_review_text("The owner Edited his response") is None
    # "owner Should" — Should is blacklisted
    assert extract_from_review_text("The owner Should have called back") is None
