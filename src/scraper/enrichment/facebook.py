"""Facebook business page scraper — extracts email + phone from About tab.

Requires saved Facebook session cookies at .fb_cookies.json.
No proxy needed. Zero Claude tokens. Pure Python + Playwright.
"""

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus
from playwright.async_api import BrowserContext
from scraper.browser import polite_wait

COOKIES_PATH = Path(__file__).parent.parent.parent / ".fb_cookies.json"
EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
SKIP_DOMAINS = {"facebook.com", "fbcdn.net", "instagram.com", "sentry.io", "wixpress.com"}


def _is_real_email(email: str) -> bool:
    domain = email.split("@")[1].lower()
    return not any(domain.endswith(d) for d in SKIP_DOMAINS)


def has_fb_cookies() -> bool:
    return COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 10


async def enrich_via_facebook(context: BrowserContext, company: str, city: str) -> dict[str, Any]:
    """Search Facebook for a business page, visit About tab, extract email."""
    result: dict[str, Any] = {"email": None}

    if not has_fb_cookies():
        return result

    # Load cookies into this context
    try:
        with open(COOKIES_PATH) as f:
            cookies = json.load(f)
        await context.add_cookies(cookies)
    except Exception:
        return result

    query = quote_plus(f"{company} {city}")
    page = await context.new_page()
    try:
        # Search Facebook Pages
        await page.goto(
            f"https://www.facebook.com/search/pages?q={query}",
            wait_until="domcontentloaded", timeout=25000,
        )
        await page.wait_for_timeout(3000)

        # Find first matching result
        first_word = company.split()[0]
        link = page.locator(f'a:has-text("{first_word}")').first
        if await link.count() == 0:
            return result

        href = await link.get_attribute("href")
        if not href or "facebook.com" not in href:
            return result

        # Navigate to About page
        about_url = href.split("?")[0].rstrip("/") + "/about"
        await page.goto(about_url, wait_until="domcontentloaded", timeout=25000)
        await page.wait_for_timeout(3000)

        text = await page.inner_text("body")
        html = await page.content()

        # Extract emails
        all_emails = EMAIL_RE.findall(text + html)
        real = [e.lower() for e in set(all_emails) if _is_real_email(e)]
        if real:
            result["email"] = real[0]

        return result
    except Exception:
        return result
    finally:
        await page.close()
        await polite_wait(min_s=4.0, max_s=8.0)
