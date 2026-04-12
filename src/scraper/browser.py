import os
from contextlib import asynccontextmanager
from typing import AsyncIterator
from playwright.async_api import async_playwright, BrowserContext, Page
import random
import asyncio

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
]


def _get_proxy_config() -> dict | None:
    """Read proxy credentials from env. Returns None if not configured."""
    host = os.environ.get("PROXY_HOST")
    port = os.environ.get("PROXY_PORT")
    user = os.environ.get("PROXY_USER")
    pw = os.environ.get("PROXY_PASS")
    if host and port and user and pw:
        return {
            "server": f"http://{host}:{port}",
            "username": user,
            "password": pw,
        }
    return None


@asynccontextmanager
async def browser_context(use_proxy: bool = False) -> AsyncIterator[BrowserContext]:
    proxy = _get_proxy_config() if use_proxy else None
    async with async_playwright() as p:
        launch_args = {
            "headless": True,
            "args": ["--disable-blink-features=AutomationControlled"],
        }
        if proxy:
            launch_args["proxy"] = proxy

        browser = await p.chromium.launch(**launch_args)
        context = await browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1366, "height": 900},
            locale="en-US",
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        try:
            yield context
        finally:
            await browser.close()


async def polite_wait(min_s: float = 2.0, max_s: float = 6.0) -> None:
    await asyncio.sleep(random.uniform(min_s, max_s))


async def fetch_page_html(context: BrowserContext, url: str, timeout_ms: int = 20000) -> str:
    page: Page = await context.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        await page.wait_for_timeout(1500)
        return await page.content()
    finally:
        await page.close()
