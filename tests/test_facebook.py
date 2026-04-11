from datetime import date
from scraper.enrichment.facebook import extract_last_post_date

def test_extract_last_post_date_parses_written_date():
    html = '<abbr>January 1, 2024</abbr>'
    d = extract_last_post_date(html)
    assert d == date(2024, 1, 1)

def test_extract_returns_none_when_no_date():
    assert extract_last_post_date("<html><body>no posts</body></html>") is None
