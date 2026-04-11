import re
from typing import Any
from urllib.parse import quote_plus
from bs4 import BeautifulSoup
from playwright.async_api import BrowserContext
from scraper.browser import polite_wait


async def search_and_fetch(context: BrowserContext, company: str, city: str) -> str | None:
    """Search Google Maps for the business and return the HTML of the selected place panel."""
    query = quote_plus(f"{company} {city} plumber")
    url = f"https://www.google.com/maps/search/{query}"
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(2500)

        # If Google landed on a list, click the first result to get its panel
        first_result = page.locator('a[href*="/maps/place/"]').first
        if await first_result.count() > 0:
            try:
                await first_result.click()
                await page.wait_for_timeout(3000)
            except Exception:
                pass

        # Try to scroll reviews into view so owner-name extraction has data
        try:
            reviews_tab = page.get_by_role("tab", name=re.compile("reviews", re.I)).first
            if await reviews_tab.count() > 0:
                await reviews_tab.click()
                await page.wait_for_timeout(2000)
        except Exception:
            pass

        html = await page.content()
        return html
    finally:
        await page.close()
        await polite_wait()


def parse_listing(html: str) -> dict[str, Any]:
    """Parse a Google Maps place HTML page. Extracts rating, review_count, review_samples."""
    result: dict[str, Any] = {
        "place_id": None,
        "rating": None,
        "review_count": None,
        "review_samples": [],
    }

    # Review count: the selected place's total review count appears exactly once
    # as `aria-label="1,417 reviews"` on the histogram summary bar. This is unique
    # vs sidebar places (which use a different pattern).
    m = re.search(r'aria-label="([\d,]+)\s*reviews?"', html)
    if m:
        try:
            result["review_count"] = int(m.group(1).replace(",", ""))
        except ValueError:
            pass

    # Rating: the big rating display uses class="fontDisplayLarge". There may be
    # multiple on the page (for sidebar places), so prefer the FIRST one which is
    # the selected place.
    m = re.search(r'class="[^"]*fontDisplayLarge[^"]*"[^>]*>([\d.]+)<', html)
    if m:
        try:
            result["rating"] = float(m.group(1))
        except ValueError:
            pass

    # Place ID: the permalink data attribute. Best-effort; Google changes this.
    m = re.search(r'!1s(0x[0-9a-f]+:0x[0-9a-f]+)', html)
    if m:
        result["place_id"] = m.group(1)

    # Review samples: Google renders review text in elements with data-review-id.
    # Grab up to 5 samples for owner-name extraction downstream.
    soup = BeautifulSoup(html, "html.parser")
    samples: list[dict[str, Any]] = []
    for block in soup.select('[data-review-id]')[:5]:
        text = block.get_text(" ", strip=True)[:500]
        if text:
            samples.append({"text": text})
    # Fallback: if Google re-structured review elements, try a generic review class
    if not samples:
        for block in soup.select('div[jsaction*="review"]')[:5]:
            text = block.get_text(" ", strip=True)[:500]
            if text:
                samples.append({"text": text})
    result["review_samples"] = samples

    return result


async def enrich_via_google(context: BrowserContext, company: str, city: str) -> dict[str, Any]:
    """Full Google Maps enrichment: search → click → parse."""
    html = await search_and_fetch(context, company, city)
    if not html:
        return {"place_id": None, "rating": None, "review_count": None, "review_samples": []}
    return parse_listing(html)
