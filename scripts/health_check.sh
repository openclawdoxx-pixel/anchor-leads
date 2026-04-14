#!/bin/bash
# Health check: runs every 15 min via launchd.
# 1. Checks if enrich loop is stalled → restarts
# 2. Checks if Facebook cookies are dead → re-logins automatically

set -euo pipefail

cd /Users/projectatlas/projects/anchor-leads
source .venv/bin/activate

PROGRESS_FILE="/tmp/anchor_enrich_last_count.txt"
FB_EMAIL_FILE="/tmp/anchor_fb_last_email_count.txt"

# === ENRICH LOOP HEALTH ===
CURRENT=$(python3 -c "
from scraper.db import Database
from scraper.config import load_config
db = Database(config=load_config())
c = db.client.table('leads').select('id',count='exact').eq('status','enriched').execute().count
print(c)
")

LAST=0
[ -f "$PROGRESS_FILE" ] && LAST=$(cat "$PROGRESS_FILE")

echo "$(date): enriched=$CURRENT (was $LAST)" >> /tmp/anchor_health.log

if [ "$CURRENT" = "$LAST" ] && [ "$LAST" != "0" ]; then
    echo "$(date): STALLED — restarting enrich loop" >> /tmp/anchor_health.log
    launchctl unload ~/Library/LaunchAgents/com.anchor.enrich.plist 2>/dev/null || true
    sleep 2
    launchctl load ~/Library/LaunchAgents/com.anchor.enrich.plist
    echo "$(date): restarted enrich" >> /tmp/anchor_health.log
fi

echo "$CURRENT" > "$PROGRESS_FILE"

# === FACEBOOK COOKIE HEALTH ===
# Check if Facebook pass is running and if cookies are still valid
FB_PID=$(pgrep -f "facebook-enrich" || true)
if [ -n "$FB_PID" ]; then
    # Facebook is supposed to be running — check if email count is growing
    FB_CURRENT=$(python3 -c "
from scraper.db import Database
from scraper.config import load_config
db = Database(config=load_config())
c = db.client.table('lead_enrichment').select('lead_id',count='exact').not_.is_('email','null').execute().count
print(c)
")
    FB_LAST=0
    [ -f "$FB_EMAIL_FILE" ] && FB_LAST=$(cat "$FB_EMAIL_FILE")
    echo "$FB_CURRENT" > "$FB_EMAIL_FILE"
fi

# Check if Facebook process died (cookies expired) — auto re-login + restart
if [ -z "$(pgrep -f 'facebook-enrich' || true)" ]; then
    # Check if there are still leads without email (worth restarting)
    NEEDS_FB=$(python3 -c "
from scraper.db import Database
from scraper.config import load_config
db = Database(config=load_config())
en = db.client.table('leads').select('id',count='exact').eq('status','enriched').execute().count
e = db.client.table('lead_enrichment').select('lead_id',count='exact').not_.is_('email','null').execute().count
print(en - e if en > e else 0)
")
    if [ "$NEEDS_FB" -gt 100 ] 2>/dev/null; then
        echo "$(date): Facebook dead, $NEEDS_FB leads need email — re-logging in" >> /tmp/anchor_health.log
        python3 -c "
import asyncio, json
from playwright.async_api import async_playwright
async def login():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
        ctx = await b.new_context(user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36', viewport={'width':1366,'height':900}, locale='en-US')
        page = await ctx.new_page()
        await page.goto('https://www.facebook.com/login', wait_until='networkidle', timeout=60000)
        await page.wait_for_timeout(2000)
        await page.fill('input[name=\"email\"]', 'thedarkness1717@gmail.com')
        await page.fill('input[name=\"pass\"]', 'Thevolkswagonthing420!')
        await page.press('input[name=\"pass\"]', 'Enter')
        await page.wait_for_timeout(8000)
        if 'login' not in page.url and 'checkpoint' not in page.url:
            cookies = await ctx.cookies()
            with open('.fb_cookies.json','w') as f: json.dump(cookies,f)
            print('OK')
        else:
            print('FAIL')
        await b.close()
asyncio.run(login())
" 2>/dev/null | grep -q "OK" && {
            echo "$(date): Facebook re-login SUCCESS — restarting pass" >> /tmp/anchor_health.log
            nohup bash -c "source .venv/bin/activate && scraper facebook-enrich --loop --limit 100" > /tmp/anchor_facebook.log 2>&1 &
        } || {
            echo "$(date): Facebook re-login FAILED (checkpoint or banned)" >> /tmp/anchor_health.log
        }
    fi
fi
