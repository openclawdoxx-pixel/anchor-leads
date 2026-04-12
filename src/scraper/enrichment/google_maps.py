"""Google Maps enrichment: rating + review count + review samples."""

import re
from typing import Any
from urllib.parse import quote_plus
from bs4 import BeautifulSoup
from playwright.async_api import BrowserContext, Page
from scraper.browser import polite_wait


async def search_and_fetch(context: BrowserContext, company: str, city: str) -> dict[str, Any] | None:
    """Search Google Maps, click into the listing, extract data via page interaction."""
    query = quote_plus(f"{company} {city} plumber")
    url = f"https://www.google.com/maps/search/{query}"
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(3000)

        # Click first result to get place detail panel
        first_result = page.locator('a[href*="/maps/place/"]').first
        if await first_result.count() > 0:
            try:
                await first_result.click()
                await page.wait_for_timeout(3000)
            except Exception:
                pass

        # Get the full HTML for review sample extraction
        html = await page.content()

        # Get the VISIBLE TEXT of the place panel for review count extraction.
        # The text contains "4.8 (459)" or "4.7 (1.4K)" patterns that HTML
        # parsing misses because Google builds it with JS.
        try:
            panel_text = await page.inner_text('[role="main"]')
        except Exception:
            panel_text = await page.inner_text('body')

        # Try clicking reviews tab for review samples
        try:
            tab = page.get_by_role("tab", name=re.compile("review", re.I)).first
            if await tab.count() > 0:
                await tab.click()
                await page.wait_for_timeout(2000)
                html = await page.content()  # re-grab with reviews loaded
        except Exception:
            pass

        return {"html": html, "panel_text": panel_text}
    finally:
        await page.close()
        await polite_wait()


def _parse_review_count(text: str) -> int | None:
    """Extract review count from visible text. Handles formats:
       (459)  ·  (1.4K)  ·  (8.7K)  ·  459 reviews  ·  1,417 reviews
    """
    # Pattern 1: "(N)" or "(N.NK)" right after a rating — most reliable
    # The text usually reads like "4.8(459)" or "4.8 (1.4K)"
    for m in re.finditer(r'(\d\.\d)\s*\((\d[\d,.]*[Kk]?)\)', text):
        raw = m.group(2).strip()
        return _parse_count_value(raw)

    # Pattern 2: "N reviews" in visible text
    for m in re.finditer(r'(\d[\d,.]*[Kk]?)\s*reviews?', text, re.IGNORECASE):
        return _parse_count_value(m.group(1))

    # Pattern 3: aria-label="N reviews" in HTML (original approach)
    # (this is called on html, not text, so handled in parse_listing)
    return None


def _parse_count_value(raw: str) -> int | None:
    """Parse '459', '1.4K', '8,700', '1,417' into an integer."""
    raw = raw.strip().replace(",", "")
    try:
        if raw.upper().endswith("K"):
            return int(float(raw[:-1]) * 1000)
        return int(float(raw))
    except (ValueError, TypeError):
        return None


def parse_listing(data: dict[str, Any]) -> dict[str, Any]:
    """Parse Google Maps data from search_and_fetch output."""
    html = data.get("html", "")
    panel_text = data.get("panel_text", "")

    result: dict[str, Any] = {
        "place_id": None,
        "rating": None,
        "review_count": None,
        "review_samples": [],
    }

    # Rating from aria-label (most reliable)
    m = re.search(r'aria-label="(\d+\.?\d*)\s*stars?\s*"', html)
    if m:
        try:
            result["rating"] = float(m.group(1))
        except ValueError:
            pass

    # Review count: try panel text first (visible text), then aria-label fallback
    rc = _parse_review_count(panel_text)
    if rc is None:
        # Fallback: aria-label in HTML
        m = re.search(r'aria-label="([\d,]+)\s*reviews?"', html)
        if m:
            rc = _parse_count_value(m.group(1))
    result["review_count"] = rc

    # Place ID
    m = re.search(r'!1s(0x[0-9a-f]+:0x[0-9a-f]+)', html)
    if m:
        result["place_id"] = m.group(1)

    # Review samples
    soup = BeautifulSoup(html, "html.parser")
    samples: list[dict[str, Any]] = []
    for block in soup.select('[data-review-id]')[:5]:
        text = block.get_text(" ", strip=True)[:500]
        if text:
            samples.append({"text": text})
    if not samples:
        for block in soup.select('div[jsaction*="review"]')[:5]:
            text = block.get_text(" ", strip=True)[:500]
            if text:
                samples.append({"text": text})
    result["review_samples"] = samples

    return result


async def enrich_via_google(context: BrowserContext, company: str, city: str) -> dict[str, Any]:
    """Full Google Maps enrichment."""
    data = await search_and_fetch(context, company, city)
    if not data:
        return {"place_id": None, "rating": None, "review_count": None, "review_samples": []}
    return parse_listing(data)
