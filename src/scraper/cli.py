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
    status: str = typer.Option("enriched", "--status", help="Lead status to export: enriched, scored, or all"),
    limit: int = typer.Option(100000, "--limit", help="Max rows to export"),
):
    """Export leads to CSV for import into GHL / power dialer."""
    import csv
    db = _db()
    q = db.client.table("leads_with_latest_call").select(
        "company_name, owner_name, phone, website, city, state, review_count, rating, best_pitch, ai_summary"
    )
    if status == "enriched":
        q = q.in_("status", ["enriched", "scored"])
    elif status == "scored":
        q = q.eq("status", "scored")
    # 'all' = no status filter
    q = q.limit(limit)
    rows = q.execute().data or []

    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "company_name", "owner_name", "phone", "website", "city", "state",
            "review_count", "rating", "best_pitch", "ai_summary",
        ])
        w.writeheader()
        for r in rows:
            w.writerow({k: (r.get(k) if r.get(k) is not None else "") for k in w.fieldnames})

    typer.echo(f"exported {len(rows)} leads to {out}")


if __name__ == "__main__":
    app()
