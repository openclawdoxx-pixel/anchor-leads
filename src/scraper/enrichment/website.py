import re
from typing import Any
from bs4 import BeautifulSoup
from scraper.models import BookingPathQuality

BUILDER_PATTERNS: list[tuple[str, str]] = [
    ("wix", r"wix\.com|wixsite|Wix\.com Website Builder"),
    ("wordpress", r"wp-content|wp-includes|WordPress\b"),
    ("godaddy", r"godaddy|gd-website|dpbolvw"),
    ("squarespace", r"squarespace|static1\.squarespace"),
    ("shopify", r"cdn\.shopify|shopify\.com"),
]

CHAT_VENDORS: list[tuple[str, str]] = [
    ("intercom", r"intercom\.io|widget\.intercom"),
    ("drift", r"drift\.com|js\.driftt"),
    ("tidio", r"tidio\.co|code\.tidio"),
    ("tawk", r"tawk\.to|embed\.tawk"),
    ("hubspot", r"hs-scripts|hubspot\.com/forms|messages\.hubspot"),
    ("gohighlevel", r"leadconnectorhq|gohighlevel"),
    ("zendesk", r"zdassets|zendesk\.com"),
]

AI_PATTERNS = r"\b(ai assistant|chatbot|powered by openai|claude|gpt-)\b"

def detect_site_builder(html: str) -> str:
    for name, pat in BUILDER_PATTERNS:
        if re.search(pat, html, re.IGNORECASE):
            return name
    return "custom"

def detect_chat_widget(html: str) -> str | None:
    for name, pat in CHAT_VENDORS:
        if re.search(pat, html, re.IGNORECASE):
            return name
    return None

def detect_ai_signals(html: str) -> bool:
    return bool(re.search(AI_PATTERNS, html, re.IGNORECASE))

def extract_last_update_year(html: str) -> int | None:
    m = re.search(r"©\s*(\d{4})", html)
    if m:
        return int(m.group(1))
    m = re.search(r"copyright\s*(?:&copy;)?\s*(\d{4})", html, re.IGNORECASE)
    return int(m.group(1)) if m else None

def extract_hero_snapshot(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    hero = soup.find("header") or soup.body or soup
    hero_text = " ".join((hero.get_text(" ", strip=True) or "").split())[:500]
    ctas: list[str] = []
    for a in hero.find_all("a"):
        text = a.get_text(strip=True)
        if text:
            ctas.append(text)
    has_phone_link = any(a.get("href", "").startswith("tel:") for a in hero.find_all("a"))
    has_booking_form = bool(hero.find("form"))
    return {
        "hero_text": hero_text,
        "above_fold_ctas": ctas[:8],
        "has_phone_link": has_phone_link,
        "has_booking_form": has_booking_form,
    }

def score_booking_path(snap: dict[str, Any]) -> BookingPathQuality:
    phone = snap.get("has_phone_link", False)
    form = snap.get("has_booking_form", False)
    if phone and form:
        return BookingPathQuality.STRONG
    if phone or form:
        return BookingPathQuality.WEAK
    return BookingPathQuality.NONE

def analyze_html(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    raw_text = soup.get_text(" ", strip=True)
    snap = extract_hero_snapshot(html)
    vendor = detect_chat_widget(html)
    return {
        "site_builder": detect_site_builder(html),
        "has_chat_widget": vendor is not None,
        "chat_widget_vendor": vendor,
        "has_ai_signals": detect_ai_signals(html),
        "last_site_update_year": extract_last_update_year(html),
        "hero_snapshot": snap,
        "booking_path_quality": score_booking_path(snap).value,
        "raw_site_text": raw_text[:20000],
    }
