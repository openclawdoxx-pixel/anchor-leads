import re
from typing import Any
from bs4 import BeautifulSoup
from playwright.async_api import BrowserContext

# Strict patterns. Prefer two-word names. Blacklist common false positives.

ABOUT_PATTERNS = [
    r"[Mm]eet\s+([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})",
    r"(?:[Oo]wner|[Ff]ounder|[Oo]wned by|[Oo]perated by|[Ee]stablished by|[Ff]ounded by)\s+([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})",
    r"([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\s*[-—,]\s*(?:owner|founder|Owner|Founder)",
]

REVIEW_PATTERNS = [
    # "owner Bob Smith" / "the owner Bob Smith" / "owner, Bob Smith"
    r"\b[Oo]wner[,\s]+([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})",
    # "Bob Smith, the owner" / "Bob Smith is the owner"
    r"\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}),?\s+(?:is\s+)?the\s+owner\b",
    # "spoke with owner Bob" — single name allowed only with specific action verbs
    r"\b(?:spoke\s+(?:to|with)|met|called|dealt\s+with)\s+(?:the\s+)?owner[,\s]+([A-Z][a-z]{3,})(?=[\s,.!?])",
]

# Words that look like names but aren't (capitalized sentence-starters, UI chrome, etc)
NAME_BLACKLIST = {
    "Google", "Owner", "Response", "Review", "Reviews", "Edited", "Updated",
    "Posted", "Called", "Should", "Could", "Would", "Took", "Just", "Even",
    "Verified", "Local", "Guide", "Photo", "Photos", "Service", "Services",
    "Company", "Business", "Job", "Work", "Thank", "Thanks", "Highly",
    "Very", "Extremely", "Really", "Super", "Only", "The", "They", "That",
    "This", "Their", "These", "Those", "From", "With", "Without",
}


def _clean_name(raw: str) -> str | None:
    """Return cleaned name or None if it looks like junk."""
    name = raw.strip()
    if not name:
        return None
    words = name.split()
    for w in words:
        if w in NAME_BLACKLIST:
            return None
    if len(words) == 1 and len(words[0]) < 4:
        return None
    return name


def extract_from_about_page(html: str) -> str | None:
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    for pat in ABOUT_PATTERNS:
        m = re.search(pat, text)
        if m:
            cleaned = _clean_name(m.group(1))
            if cleaned:
                return cleaned
    return None


def extract_from_review_text(text: str) -> str | None:
    for pat in REVIEW_PATTERNS:
        m = re.search(pat, text)
        if m:
            cleaned = _clean_name(m.group(1))
            if cleaned:
                return cleaned
    return None


async def lookup_owner(
    context: BrowserContext,
    website: str | None,
    review_samples: list[dict[str, Any]],
) -> str | None:
    """Full owner lookup chain — kept for optional use."""
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
    for r in review_samples:
        name = extract_from_review_text(r.get("text", ""))
        if name:
            return name
    return None
