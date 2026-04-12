import asyncio
import typer
from scraper.config import load_config
from scraper.db import Database
from scraper.stages.discover import run_discover, run_discover_nation
from scraper.stages.filter import run_filter
from scraper.stages.enrich import run_enrich
from scraper.stages.score import run_score
from scraper.llm import LLMScorer

app = typer.Typer(help="Anchor Leads — plumber lead scraper pipeline")

def _db() -> Database:
    return Database(config=load_config())

@app.command()
def discover(state: str = typer.Option(..., "--state", help="Two-letter state code, or 'ALL' for every US state")):
    """Stage 1: pull plumber POIs from Overture Maps and insert into leads table."""
    from scraper.stages.discover import STATE_BBOXES
    db = _db()
    if state.upper() == "ALL":
        total = 0
        for st in sorted(STATE_BBOXES.keys()):
            typer.echo(f"--- discovering {st} ---")
            try:
                count = run_discover(state=st, db=db)
                db.log_run("discover", st, processed=count, succeeded=count, failed=0)
                typer.echo(f"  {st}: {count} leads")
                total += count
            except Exception as e:
                typer.echo(f"  {st}: FAILED {e}")
                db.log_run("discover", st, processed=0, succeeded=0, failed=1, notes=str(e)[:200])
        typer.echo(f"TOTAL discovered across all states: {total}")
    else:
        count = run_discover(state=state.upper(), db=db)
        db.log_run("discover", state.upper(), processed=count, succeeded=count, failed=0)
        typer.echo(f"discovered {count} leads in {state.upper()}")

@app.command("discover-nation")
def discover_nation_cmd():
    """Single nation-wide Overture query. Gets all ~107k US plumbers (no bbox gaps)."""
    db = _db()
    count = run_discover_nation(db=db)
    db.log_run("discover_nation", "US", processed=count, succeeded=count, failed=0)
    typer.echo(f"discovered {count} leads nation-wide")


@app.command("filter")
def filter_cmd():
    """Stage 2: apply pre-enrichment ICP filter (phone + state)."""
    db = _db()
    result = run_filter(db=db)
    total = result["qualified"] + result["rejected"]
    db.log_run("filter", None, processed=total, succeeded=result["qualified"], failed=0,
               notes=f"rejected={result['rejected']}")
    typer.echo(f"qualified={result['qualified']} rejected={result['rejected']}")

@app.command()
def enrich(
    limit: int = typer.Option(500, "--limit"),
    loop: bool = typer.Option(False, "--loop", help="Run continuously until no qualified leads remain"),
):
    """Stage 3: enrich qualified leads (website + gmaps + owner + facebook)."""
    db = _db()
    while True:
        result = asyncio.run(run_enrich(db=db, limit=limit))
        db.log_run("enrich", None, **result)
        typer.echo(f"enriched: {result}")
        if not loop or result["processed"] == 0:
            break

@app.command()
def score(
    limit: int = typer.Option(500, "--limit"),
    loop: bool = typer.Option(False, "--loop"),
):
    """Stage 4: LLM-score enriched leads into sales-intel notes."""
    db = _db()
    scorer = LLMScorer()
    while True:
        result = run_score(db=db, scorer=scorer, limit=limit)
        db.log_run("score", None, **result)
        typer.echo(f"scored: {result}")
        if not loop or result["processed"] == 0:
            break

@app.command()
def export(
    out: str = typer.Option("leads.csv", "--out", help="Output CSV path"),
    smartlead: bool = typer.Option(False, "--smartlead", help="Format for Smartlead cold email import"),
    only_with_email: bool = typer.Option(False, "--only-with-email", help="Skip leads without an email address"),
    distinct_email: bool = typer.Option(True, "--distinct-email/--allow-duplicate-email", help="Only output one row per unique email"),
    trade: str = typer.Option("all", "--trade", help="Filter by trade: plumber, electrician, or all"),
    limit: int = typer.Option(100000, "--limit", help="Max rows to export"),
):
    """Export enriched leads to CSV for import into Smartlead / GHL / power dialer."""
    import csv
    db = _db()
    q = db.client.table("leads_final").select("*")
    if trade != "all":
        q = q.eq("trade", trade)
    rows = q.limit(limit).execute().data or []

    if only_with_email:
        rows = [r for r in rows if r.get("email")]

    if distinct_email:
        seen = set()
        deduped = []
        for r in rows:
            email = r.get("email")
            if email and email in seen:
                continue
            if email:
                seen.add(email)
            deduped.append(r)
        rows = deduped

    if smartlead:
        # Smartlead import format: email required, first_name/last_name optional,
        # everything else becomes a custom variable
        fieldnames = [
            "email", "first_name", "last_name", "company_name",
            "phone", "website", "city", "state", "rating", "review_count",
        ]
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            for r in rows:
                owner = (r.get("owner_name") or "").strip()
                first_name, _, last_name = owner.partition(" ")
                w.writerow({
                    "email": r.get("email") or "",
                    "first_name": first_name,
                    "last_name": last_name,
                    "company_name": r.get("company_name") or "",
                    "phone": r.get("phone") or "",
                    "website": r.get("website") or "",
                    "city": r.get("city") or "",
                    "state": r.get("state") or "",
                    "rating": r.get("rating") or "",
                    "review_count": r.get("review_count") or "",
                })
    else:
        fieldnames = [
            "company_name", "owner_name", "phone", "email", "website",
            "city", "state", "review_count", "rating",
        ]
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            for r in rows:
                w.writerow({k: (r.get(k) if r.get(k) is not None else "") for k in fieldnames})

    typer.echo(f"exported {len(rows)} leads to {out} (smartlead={smartlead}, email_only={only_with_email})")


@app.command("verify-emails")
def verify_emails_cmd():
    """Free MX-based email verification. Nulls out emails with dead domains."""
    from scraper.enrichment.email_verify import verify_email_free
    db = _db()

    # Pull all emails
    all_rows: list[dict] = []
    offset = 0
    while True:
        batch = db.client.table("lead_enrichment").select("lead_id,email").not_.is_("email", "null").range(offset, offset + 999).execute().data
        if not batch:
            break
        all_rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    typer.echo(f"verifying {len(all_rows)} emails via MX lookup...")
    valid = invalid = 0
    for row in all_rows:
        status = verify_email_free(row["email"])
        if status.startswith("invalid"):
            db.client.table("lead_enrichment").update({"email": None}).eq("lead_id", row["lead_id"]).execute()
            invalid += 1
        else:
            valid += 1

    typer.echo(f"done: {valid} valid, {invalid} removed (dead domains)")


@app.command("review-count")
def review_count_cmd(
    limit: int = typer.Option(500, "--limit"),
    loop: bool = typer.Option(False, "--loop"),
):
    """Backfill review counts from Google Maps. Runs SLOW (1 req/15s) to avoid rate limiting."""
    import asyncio
    from scraper.browser import browser_context, polite_wait
    from scraper.enrichment.google_maps import search_and_fetch, parse_listing

    db = _db()

    async def _run():
        while True:
            # Get enriched leads that don't have a review_count yet
            rows = (
                db.client.table("leads")
                .select("id, company_name, city, state")
                .eq("status", "enriched")
                .limit(limit)
                .execute()
                .data or []
            )
            # Filter to ones where lead_enrichment.review_count is null
            to_process = []
            for row in rows:
                e = db.client.table("lead_enrichment").select("review_count").eq("lead_id", row["id"]).execute().data
                if e and e[0].get("review_count") is None:
                    to_process.append(row)
                if len(to_process) >= limit:
                    break

            if not to_process:
                if loop:
                    typer.echo("no leads needing review count, sleeping 60s...")
                    await asyncio.sleep(60)
                    continue
                break

            typer.echo(f"backfilling review count for {len(to_process)} leads (slow mode)...")
            succeeded = failed = 0
            async with browser_context() as ctx:
                for row in to_process:
                    try:
                        data = await search_and_fetch(ctx, row["company_name"], row.get("city") or row["state"])
                        if data:
                            result = parse_listing(data)
                            if result["review_count"] is not None:
                                db.client.table("lead_enrichment").update({
                                    "review_count": result["review_count"],
                                    "rating": result.get("rating"),
                                }).eq("lead_id", row["id"]).execute()

                                # Reject if too big
                                if result["review_count"] >= 100:
                                    db.client.table("leads").update({"status": "rejected"}).eq("id", row["id"]).execute()

                                succeeded += 1
                            else:
                                failed += 1
                        else:
                            failed += 1
                        # SLOW: 15 seconds between requests to avoid rate limiting
                        await polite_wait(min_s=12.0, max_s=18.0)
                    except Exception as exc:
                        typer.echo(f"  error {row['company_name']}: {exc}")
                        failed += 1

            typer.echo(f"review-count: {succeeded} updated, {failed} missed")
            if not loop:
                break

    asyncio.run(_run())


if __name__ == "__main__":
    app()
