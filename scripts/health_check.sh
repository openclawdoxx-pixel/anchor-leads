#!/bin/bash
# Health check: verify the enrich loop is actually making progress.
# Runs every 15 min via launchd. If enriched count hasn't grown, restart the loop.

set -euo pipefail

cd /Users/projectatlas/projects/anchor-leads
source .venv/bin/activate

PROGRESS_FILE="/tmp/anchor_enrich_last_count.txt"

# Get current enriched count
CURRENT=$(python3 -c "
from scraper.db import Database
from scraper.config import load_config
db = Database(config=load_config())
c = db.client.table('leads').select('id',count='exact').eq('status','enriched').execute().count
print(c)
")

# Get last known count
LAST=0
if [ -f "$PROGRESS_FILE" ]; then
    LAST=$(cat "$PROGRESS_FILE")
fi

echo "$(date): enriched=$CURRENT (was $LAST)" >> /tmp/anchor_health.log

if [ "$CURRENT" = "$LAST" ] && [ "$LAST" != "0" ]; then
    echo "$(date): STALLED — restarting enrich loop" >> /tmp/anchor_health.log
    launchctl unload ~/Library/LaunchAgents/com.anchor.enrich.plist 2>/dev/null || true
    sleep 2
    launchctl load ~/Library/LaunchAgents/com.anchor.enrich.plist
    echo "$(date): restarted" >> /tmp/anchor_health.log
fi

# Save current count for next check
echo "$CURRENT" > "$PROGRESS_FILE"
