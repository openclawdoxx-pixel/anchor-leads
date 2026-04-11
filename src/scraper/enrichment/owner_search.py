"""Fallback: Google search "company owner" and parse the result snippets."""

import re
from urllib.parse import quote_plus
from playwright.async_api import BrowserContext
from scraper.browser import polite_wait
from scraper.enrichment.owner import _clean_name

# Patterns that match how Google presents owner names in search snippets
# and knowledge panels. Examples:
#   "Founder: John Smith"
#   "Owner: Jane Doe"
#   "run by Bob Smith"
#   "... John Smith, owner of ..."
SNIPPET_PATTERNS = [
    r"(?:Founder|Owner|CEO|President|Proprietor)[:\s]+([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})",
    r"([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\s*(?:is\s+)?(?:the\s+)?(?:owner|founder|proprietor)",
    r"(?:owned|run|founded|operated)\s+by\s+([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})",
]


async def search_owner_via_google(
    context: BrowserContext,
    company: str,
    city: str,
) -> str | None:
    """Try to find the owner's name by Google-searching for it. Best-effort."""
    query = quote_plus(f'"{company}" {city} owner')
    url = f"https://www.google.com/search?q={query}"
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(1500)
        text = await page.inner_text("body")
    except Exception:
        return None
    finally:
        await page.close()
        await polite_wait(min_s=1.0, max_s=2.5)

    # Check each pattern against the visible text
    for pat in SNIPPET_PATTERNS:
        m = re.search(pat, text)
        if m:
            name = _clean_name(m.group(1))
            if name:
                return name
    return None
