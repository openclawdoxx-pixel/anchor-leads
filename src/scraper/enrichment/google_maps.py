import re
from typing import Any
from urllib.parse import quote_plus
from bs4 import BeautifulSoup
from playwright.async_api import BrowserContext
from scraper.browser import polite_wait

async def search_and_fetch(context: BrowserContext, company: str, city: str) -> str | None:
    query = quote_plus(f"{company} {city} plumber")
    url = f"https://www.google.com/maps/search/{query}"
    page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(2500)
        first_result = page.locator('a[href*="/maps/place/"]').first
        if await first_result.count() == 0:
            return None
        await first_result.click()
        await page.wait_for_timeout(3000)
        html = await page.content()
        return html
    finally:
        await page.close()
        await polite_wait()

def parse_listing(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    rating = None
    m = re.search(r'(\d\.\d)\s*stars?', html, re.IGNORECASE)
    if m:
        try:
            rating = float(m.group(1))
        except ValueError:
            pass
    review_count = None
    m = re.search(r'([\d,]+)\s*reviews?', html, re.IGNORECASE)
    if m:
        review_count = int(m.group(1).replace(",", ""))
    place_id = None
    m = re.search(r'!1s(0x[0-9a-f]+:0x[0-9a-f]+)', html)
    if m:
        place_id = m.group(1)
    samples: list[dict[str, Any]] = []
    for block in soup.select('[data-review-id]')[:5]:
        text = block.get_text(" ", strip=True)[:500]
        if text:
            samples.append({"text": text})
    return {
        "place_id": place_id,
        "rating": rating,
        "review_count": review_count,
        "review_samples": samples,
    }

async def enrich_via_google(context: BrowserContext, company: str, city: str) -> dict[str, Any]:
    html = await search_and_fetch(context, company, city)
    if not html:
        return {"place_id": None, "rating": None, "review_count": None, "review_samples": []}
    return parse_listing(html)
