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

@asynccontextmanager
async def browser_context() -> AsyncIterator[BrowserContext]:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
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
