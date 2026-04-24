"""Facebook fast enrichment — mbasic.facebook.com via httpx (no browser).

Reuses .fb_cookies.json from the Playwright path. mbasic is Facebook's
server-rendered low-bandwidth site: flat HTML, no JS, parses with BeautifulSoup.
Target speedup: 10x+ vs Chromium on the same lead set.

Raises FacebookCookieExpired when the session is dead — caller should
exit the run and trigger a relogin (scripts/health_check.sh).
"""

import asyncio
import json
import random
import re
from typing import Any
from urllib.parse import quote_plus, urljoin

import httpx
from bs4 import BeautifulSoup

from scraper.enrichment.facebook import (
    COOKIES_PATH,
    EMAIL_RE,
    OWNER_PATTERNS,
    _is_real_email,
    has_fb_cookies,
)

MBASIC = "https://mbasic.facebook.com"
DESKTOP_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
LOGIN_WALL_MARKERS = ("/login/?next", "Log into Facebook", "Log in to Facebook")


class FacebookCookieExpired(Exception):
    """mbasic redirected to the login wall — cookies are stale."""


def load_fb_cookies_for_httpx() -> httpx.Cookies:
    """Load .fb_cookies.json (Playwright format) into an httpx cookie jar."""
    jar = httpx.Cookies()
    if not has_fb_cookies():
        return jar
    with open(COOKIES_PATH) as f:
        raw = json.load(f)
    for c in raw:
        jar.set(
            c["name"],
            c["value"],
            domain=c.get("domain", ".facebook.com"),
            path=c.get("path", "/"),
        )
    return jar


def make_client(timeout: float = 15.0) -> httpx.AsyncClient:
    """AsyncClient pre-loaded with FB cookies + realistic headers."""
    return httpx.AsyncClient(
        cookies=load_fb_cookies_for_httpx(),
        headers={
            "User-Agent": DESKTOP_UA,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        },
        timeout=timeout,
        follow_redirects=True,
        http2=True,
    )


def _check_login_wall(final_url: str, html: str) -> None:
    if "/login" in final_url or "/checkpoint" in final_url:
        raise FacebookCookieExpired(
            "Facebook redirected to login/checkpoint — .fb_cookies.json is stale. "
            "Run scripts/health_check.sh to refresh."
        )
    for marker in LOGIN_WALL_MARKERS:
        if marker in html:
            raise FacebookCookieExpired(
                "Facebook served login wall — .fb_cookies.json is stale. "
                "Run scripts/health_check.sh to refresh."
            )


def _pick_result(html: str, company: str) -> str | None:
    """First mbasic result URL whose link text contains company's first word."""
    first_word = company.split()[0].lower()
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        text = (a.get_text() or "").strip().lower()
        if not text or first_word not in text:
            continue
        href = a["href"]
        if href.startswith(("/search", "#", "/reg", "/login", "/help")):
            continue
        return urljoin(MBASIC, href.split("?")[0])
    return None


def _extract_email(text: str, html: str) -> str | None:
    candidates = EMAIL_RE.findall(text + " " + html)
    real = [e.lower() for e in set(candidates) if _is_real_email(e)]
    return real[0] if real else None


def _extract_owner(text: str) -> str | None:
    for pat in OWNER_PATTERNS:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip()
    return None


async def enrich_via_mbasic(
    client: httpx.AsyncClient,
    company: str,
    city: str,
) -> dict[str, Any]:
    """Search mbasic for a business page; return {'email', 'owner_name'}.

    Returns empty values on any non-fatal failure. Raises FacebookCookieExpired
    when the session is dead so the caller can abort the whole run.
    """
    result: dict[str, Any] = {"email": None, "owner_name": None}

    query = quote_plus(f"{company} {city}")
    search_url = f"{MBASIC}/search/pages/?q={query}"

    try:
        r = await client.get(search_url)
    except httpx.HTTPError:
        return result
    if r.status_code >= 400:
        return result
    _check_login_wall(str(r.url), r.text)

    page_url = _pick_result(r.text, company)
    if not page_url:
        return result

    await asyncio.sleep(random.uniform(0.4, 1.0))

    try:
        r2 = await client.get(page_url)
    except httpx.HTTPError:
        return result
    if r2.status_code >= 400:
        return result
    _check_login_wall(str(r2.url), r2.text)

    html = r2.text
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ")

    result["email"] = _extract_email(text, html)
    result["owner_name"] = _extract_owner(text)

    return result
