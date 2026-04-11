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
