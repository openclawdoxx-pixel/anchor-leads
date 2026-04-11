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
