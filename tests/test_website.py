from pathlib import Path
from scraper.enrichment.website import (
    analyze_html, detect_site_builder, detect_chat_widget,
    extract_hero_snapshot, score_booking_path, extract_last_update_year,
)
from scraper.models import BookingPathQuality

def _load(name: str) -> str:
    return Path(f"tests/fixtures/sites/{name}").read_text()

def test_detect_wix():
    assert detect_site_builder(_load("wix_no_chat.html")) == "wix"

def test_detect_wordpress():
    assert detect_site_builder(_load("wordpress_with_intercom.html")) == "wordpress"

def test_detect_intercom_widget():
    vendor = detect_chat_widget(_load("wordpress_with_intercom.html"))
    assert vendor == "intercom"

def test_no_widget_on_wix_site():
    assert detect_chat_widget(_load("wix_no_chat.html")) is None

def test_extract_last_update_year():
    assert extract_last_update_year(_load("wix_no_chat.html")) == 2019
    assert extract_last_update_year(_load("wordpress_with_intercom.html")) == 2024

def test_weak_hero_snapshot():
    snap = extract_hero_snapshot(_load("weak_hero.html"))
    assert snap["has_phone_link"] is False
    assert snap["has_booking_form"] is False
    assert score_booking_path(snap) == BookingPathQuality.NONE

def test_strong_hero_snapshot():
    snap = extract_hero_snapshot(_load("strong_hero.html"))
    assert snap["has_phone_link"] is True
    assert snap["has_booking_form"] is True
    assert score_booking_path(snap) == BookingPathQuality.STRONG

def test_analyze_html_end_to_end():
    result = analyze_html(_load("wordpress_with_intercom.html"))
    assert result["site_builder"] == "wordpress"
    assert result["chat_widget_vendor"] == "intercom"
    assert result["has_chat_widget"] is True
    assert result["last_site_update_year"] == 2024
