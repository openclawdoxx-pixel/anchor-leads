"""Lightweight HTTP fetcher — replaces Playwright for simple website scraping.

Uses httpx (async HTTP client) instead of a full Chromium browser.
Memory: ~0 MB per request vs ~200 MB per Playwright tab.
Speed: ~0.5s per page vs ~5s per page.

Use this for plumber/electrician websites. Use Playwright ONLY for
Facebook (needs JS rendering + login cookies).
"""

import httpx
import random

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
]


async def fetch_html(url: str, timeout: float = 10.0) -> str | None:
    """Fetch a page's HTML via plain HTTP. No browser, no JS rendering."""
    if not url:
        return None
    if not url.startswith("http"):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
            headers={"User-Agent": random.choice(USER_AGENTS)},
        ) as client:
            r = await client.get(url)
            if r.status_code == 200:
                return r.text
    except Exception:
        pass
    return None
