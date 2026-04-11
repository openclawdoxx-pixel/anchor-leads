"""Free email + contact finder — scrapes the plumber's own website and Yellow Pages."""

import re
from typing import Any
from urllib.parse import quote_plus, urlparse
from bs4 import BeautifulSoup
from playwright.async_api import BrowserContext
from scraper.browser import fetch_page_html, polite_wait

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

# Email addresses that are clearly not the business's contact
EMAIL_BLACKLIST = {
    "example.com", "email.com", "yourcompany.com", "domain.com",
    "sentry.io", "wixpress.com", "wix.com", "godaddy.com",
    "google.com", "gmail.example.com",
}

ROLE_PREFIXES = {"info", "contact", "hello", "office", "service", "admin",
                 "support", "sales", "billing", "reception", "enquiries"}


def _is_valid_email(email: str) -> bool:
    if not email or "@" not in email:
        return False
    local, _, domain = email.partition("@")
    domain = domain.lower().strip(".")
    if domain in EMAIL_BLACKLIST:
        return False
    # Reject file extensions that sometimes match the regex
    if any(domain.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".js", ".css"]):
        return False
    return True


def _score_email(email: str) -> int:
    """Higher score = better. Personal addresses score higher than role addresses."""
    local = email.split("@")[0].lower()
    # Role addresses get a lower score so personal emails win tie-breaks
    if local in ROLE_PREFIXES:
        return 1
    if any(local.startswith(p) for p in ROLE_PREFIXES):
        return 2
    return 5  # personal-looking address


def extract_emails_from_html(html: str) -> list[str]:
    """Pull all unique valid emails from a page, best-scored first."""
    found = set()

    # 1. mailto: links are the most reliable
    for m in re.finditer(r'mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', html):
        found.add(m.group(1).lower())

    # 2. plain text @ patterns
    for m in EMAIL_RE.finditer(html):
        found.add(m.group(0).lower())

    valid = [e for e in found if _is_valid_email(e)]
    valid.sort(key=_score_email, reverse=True)
    return valid


async def _fetch_safely(context: BrowserContext, url: str, timeout_ms: int = 12000) -> str | None:
    try:
        return await fetch_page_html(context, url, timeout_ms=timeout_ms)
    except Exception:
        return None


async def find_email_from_website(context: BrowserContext, website: str) -> str | None:
    """Fetch the plumber's own website and try to find a contact email."""
    if not website:
        return None

    # Normalize URL
    if not website.startswith("http"):
        website = "https://" + website
    parsed = urlparse(website)
    base = f"{parsed.scheme}://{parsed.netloc}"

    paths_to_try = ["", "/contact", "/contact-us", "/about", "/about-us"]

    for path in paths_to_try:
        html = await _fetch_safely(context, base + path)
        if not html:
            continue
        emails = extract_emails_from_html(html)
        # Prefer emails on the plumber's own domain
        own_domain_emails = [e for e in emails if parsed.netloc.replace("www.", "") in e]
        if own_domain_emails:
            return own_domain_emails[0]
        if emails:
            return emails[0]
        # Polite delay between path attempts on same site
        await polite_wait(min_s=0.5, max_s=1.5)

    return None


async def find_data_from_yellowpages(
    context: BrowserContext,
    company: str,
    city: str,
    state: str,
) -> dict[str, Any]:
    """Search Yellow Pages for email. Returns {email: str} or {}."""
    result: dict[str, Any] = {}

    query = quote_plus(f"{company} {city} {state}")
    loc = quote_plus(f"{city}, {state}")
    search_url = f"https://www.yellowpages.com/search?search_terms={query}&geo_location_terms={loc}"

    search_html = await _fetch_safely(context, search_url, timeout_ms=20000)
    if not search_html or "captcha" in search_html.lower():
        return result

    # Some listings show emails directly on the search page
    emails = extract_emails_from_html(search_html)
    if emails:
        result["email"] = emails[0]
        return result

    # Find the first business detail page link
    soup = BeautifulSoup(search_html, "html.parser")
    business_link = None
    for a in soup.select("a.business-name"):
        href = a.get("href", "")
        if href and "/mip/" in href:
            business_link = href
            break

    if business_link:
        if not business_link.startswith("http"):
            business_link = "https://www.yellowpages.com" + business_link
        detail_html = await _fetch_safely(context, business_link, timeout_ms=15000)
        if detail_html:
            detail_emails = extract_emails_from_html(detail_html)
            if detail_emails:
                result["email"] = detail_emails[0]

    return result
