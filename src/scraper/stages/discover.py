from typing import Any, Iterable
import duckdb
from scraper.db import Database
from scraper.models import Lead, LeadStatus

OVERTURE_PLACES_URL = (
    "s3://overturemaps-us-west-2/release/2026-03-18.0/theme=places/type=place/*"
)

STATE_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "NY": (-79.76, 40.49, -71.85, 45.02),
    "PA": (-80.52, 39.71, -74.69, 42.27),
    "NJ": (-75.56, 38.93, -73.88, 41.36),
    "CT": (-73.73, 40.98, -71.78, 42.05),
    "MA": (-73.51, 41.23, -69.93, 42.89),
    "RI": (-71.89, 41.14, -71.12, 42.02),
    "VT": (-73.44, 42.72, -71.46, 45.02),
    "NH": (-72.56, 42.70, -70.61, 45.31),
    "ME": (-71.08, 43.06, -66.95, 47.46),
}

PLUMBER_CATEGORIES = {"plumber", "plumbing", "plumbing_service", "plumbing_contractor"}

def parse_overture_row(row: dict[str, Any], state: str) -> Lead:
    names = row.get("names") or {}
    phones = row.get("phones") or []
    websites = row.get("websites") or []
    addresses = row.get("addresses") or [{}]
    addr = addresses[0] if addresses else {}
    geom = row.get("geometry") or {}
    coords = geom.get("coordinates") or [None, None]
    return Lead(
        overture_id=row.get("id"),
        company_name=names.get("primary") or "Unknown",
        phone=phones[0] if phones else None,
        website=websites[0] if websites else None,
        address=addr.get("freeform"),
        city=addr.get("locality"),
        state=state,
        lng=coords[0],
        lat=coords[1],
        status=LeadStatus.DISCOVERED,
    )

def query_overture(state: str) -> list[dict[str, Any]]:
    """Query Overture Maps parquet for plumber POIs in a state's bounding box."""
    if state not in STATE_BBOXES:
        raise ValueError(f"No bbox for state {state}")
    min_lng, min_lat, max_lng, max_lat = STATE_BBOXES[state]
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    categories_list = "', '".join(PLUMBER_CATEGORIES)
    sql = f"""
        SELECT
          id,
          names,
          categories,
          phones,
          websites,
          addresses,
          ST_AsGeoJSON(geometry) AS geometry_json
        FROM read_parquet('{OVERTURE_PLACES_URL}', hive_partitioning=1)
        WHERE bbox.xmin >= {min_lng} AND bbox.xmax <= {max_lng}
          AND bbox.ymin >= {min_lat} AND bbox.ymax <= {max_lat}
          AND categories.primary IN ('{categories_list}')
    """
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    import json as _json
    result = []
    for r in rows:
        d = dict(zip(cols, r))
        d["geometry"] = _json.loads(d.pop("geometry_json"))
        result.append(d)
    return result

def run_discover(state: str, db: Database, rows: Iterable[dict[str, Any]] | None = None) -> int:
    if rows is None:
        rows = query_overture(state)
    count = 0
    for row in rows:
        try:
            lead = parse_overture_row(row, state=state)
            db.upsert_lead(lead)
            count += 1
        except Exception as e:
            print(f"[discover] skip row {row.get('id')}: {e}")
    return count
