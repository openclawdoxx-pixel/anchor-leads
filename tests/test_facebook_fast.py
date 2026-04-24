"""Tests for mbasic.facebook.com enrichment path.

Uses respx to stub httpx so no network is hit.
"""

import pytest
import httpx
import respx

from scraper.enrichment.facebook_fast import (
    enrich_via_mbasic,
    _pick_result,
    FacebookCookieExpired,
)


SEARCH_HTML_WITH_RESULT = """
<html><body>
<div class="search-results">
  <a href="/AcmePlumbingBuffalo/">Acme Plumbing</a>
  <a href="/other/">Some Other Page</a>
</div>
</body></html>
"""

PAGE_HTML_WITH_EMAIL = """
<html><body>
<div class="sidebar">
  <section><h4>Contact Info</h4>
    <div>Call (716) 555-0123</div>
    <div>contact@acmeplumbing.com</div>
    <div>Founded by John Doe in 1987</div>
  </section>
</div>
</body></html>
"""

PAGE_HTML_NO_DATA = "<html><body><div>No contact info yet.</div></body></html>"

SEARCH_HTML_EMPTY = "<html><body><div>No results for your query.</div></body></html>"

LOGIN_WALL_HTML = """
<html><body>
<form action="/login/?next=/home.php"><input name="email"/></form>
Log in to Facebook to continue.
</body></html>
"""


def test_pick_result_matches_first_word():
    url = _pick_result(SEARCH_HTML_WITH_RESULT, "Acme Plumbing Services")
    assert url == "https://mbasic.facebook.com/AcmePlumbingBuffalo/"


def test_pick_result_skips_search_and_reg_anchors():
    html = """<a href="/search/more">Acme extra</a><a href="/reg/">Acme signup</a><a href="/AcmeCo">Acme Co</a>"""
    url = _pick_result(html, "Acme")
    assert url == "https://mbasic.facebook.com/AcmeCo"


def test_pick_result_no_match():
    assert _pick_result(SEARCH_HTML_EMPTY, "Acme") is None


@pytest.mark.asyncio
@respx.mock
async def test_enrich_extracts_email_and_owner():
    respx.get("https://mbasic.facebook.com/search/pages/").mock(
        return_value=httpx.Response(200, text=SEARCH_HTML_WITH_RESULT)
    )
    respx.get("https://mbasic.facebook.com/AcmePlumbingBuffalo/").mock(
        return_value=httpx.Response(200, text=PAGE_HTML_WITH_EMAIL)
    )

    async with httpx.AsyncClient() as client:
        result = await enrich_via_mbasic(client, "Acme Plumbing", "Buffalo NY")

    assert result["email"] == "contact@acmeplumbing.com"
    assert result["owner_name"] == "John Doe"


@pytest.mark.asyncio
@respx.mock
async def test_enrich_empty_search_returns_nulls():
    respx.get("https://mbasic.facebook.com/search/pages/").mock(
        return_value=httpx.Response(200, text=SEARCH_HTML_EMPTY)
    )

    async with httpx.AsyncClient() as client:
        result = await enrich_via_mbasic(client, "Nonesuch Plumbing", "Nowhere")

    assert result == {"email": None, "owner_name": None}


@pytest.mark.asyncio
@respx.mock
async def test_enrich_page_without_contact_returns_nulls():
    respx.get("https://mbasic.facebook.com/search/pages/").mock(
        return_value=httpx.Response(200, text=SEARCH_HTML_WITH_RESULT)
    )
    respx.get("https://mbasic.facebook.com/AcmePlumbingBuffalo/").mock(
        return_value=httpx.Response(200, text=PAGE_HTML_NO_DATA)
    )

    async with httpx.AsyncClient() as client:
        result = await enrich_via_mbasic(client, "Acme Plumbing", "Buffalo")

    assert result == {"email": None, "owner_name": None}


@pytest.mark.asyncio
@respx.mock
async def test_enrich_raises_on_login_wall():
    respx.get("https://mbasic.facebook.com/search/pages/").mock(
        return_value=httpx.Response(200, text=LOGIN_WALL_HTML)
    )

    async with httpx.AsyncClient() as client:
        with pytest.raises(FacebookCookieExpired):
            await enrich_via_mbasic(client, "Acme", "Buffalo")


@pytest.mark.asyncio
@respx.mock
async def test_enrich_swallows_http_errors_returns_nulls():
    respx.get("https://mbasic.facebook.com/search/pages/").mock(
        side_effect=httpx.ConnectError("boom")
    )

    async with httpx.AsyncClient() as client:
        result = await enrich_via_mbasic(client, "Acme", "Buffalo")

    assert result == {"email": None, "owner_name": None}
