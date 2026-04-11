from typing import Any, Iterable
import duckdb
from scraper.db import Database
from scraper.models import Lead, LeadStatus

OVERTURE_PLACES_URL = (
    "s3://overturemaps-us-west-2/release/2026-03-18.0/theme=places/type=place/*"
)

STATE_BBOXES: dict[str, tuple[float, float, float, float]] = {
    # (min_lng, min_lat, max_lng, max_lat) for all 50 US states
    "AL": (-88.47, 30.14, -84.89, 35.01),
    "AK": (-179.15, 51.21, -129.99, 71.35),
    "AZ": (-114.82, 31.33, -109.04, 37.00),
    "AR": (-94.62, 33.00, -89.64, 36.50),
    "CA": (-124.48, 32.53, -114.13, 42.01),
    "CO": (-109.06, 36.99, -102.04, 41.00),
    "CT": (-73.73, 40.98, -71.78, 42.05),
    "DE": (-75.79, 38.45, -75.05, 39.84),
    "FL": (-87.63, 24.39, -80.03, 31.00),
    "GA": (-85.61, 30.36, -80.84, 35.00),
    "HI": (-161.07, 18.91, -154.81, 22.24),
    "ID": (-117.24, 41.99, -111.04, 49.00),
    "IL": (-91.51, 36.97, -87.02, 42.51),
    "IN": (-88.10, 37.77, -84.78, 41.76),
    "IA": (-96.64, 40.38, -90.14, 43.50),
    "KS": (-102.05, 36.99, -94.59, 40.00),
    "KY": (-89.57, 36.50, -81.96, 39.15),
    "LA": (-94.04, 28.93, -88.82, 33.02),
    "ME": (-71.08, 43.06, -66.95, 47.46),
    "MD": (-79.49, 37.89, -75.05, 39.72),
    "MA": (-73.51, 41.23, -69.93, 42.89),
    "MI": (-90.42, 41.70, -82.41, 48.30),
    "MN": (-97.24, 43.50, -89.49, 49.39),
    "MS": (-91.66, 30.17, -88.10, 34.99),
    "MO": (-95.77, 35.99, -89.10, 40.61),
    "MT": (-116.05, 44.36, -104.04, 49.00),
    "NE": (-104.05, 39.99, -95.31, 43.00),
    "NV": (-120.01, 35.00, -114.04, 42.00),
    "NH": (-72.56, 42.70, -70.61, 45.31),
    "NJ": (-75.56, 38.93, -73.88, 41.36),
    "NM": (-109.05, 31.33, -103.00, 37.00),
    "NY": (-79.76, 40.49, -71.85, 45.02),
    "NC": (-84.32, 33.84, -75.46, 36.59),
    "ND": (-104.05, 45.94, -96.55, 49.00),
    "OH": (-84.82, 38.40, -80.52, 42.00),
    "OK": (-103.00, 33.62, -94.43, 37.00),
    "OR": (-124.55, 41.99, -116.46, 46.29),
    "PA": (-80.52, 39.71, -74.69, 42.27),
    "RI": (-71.89, 41.14, -71.12, 42.02),
    "SC": (-83.35, 32.03, -78.54, 35.22),
    "SD": (-104.06, 42.48, -96.44, 45.95),
    "TN": (-90.31, 34.98, -81.65, 36.68),
    "TX": (-106.65, 25.84, -93.51, 36.50),
    "UT": (-114.05, 36.99, -109.04, 42.00),
    "VT": (-73.44, 42.72, -71.46, 45.02),
    "VA": (-83.68, 36.54, -75.24, 39.47),
    "WA": (-124.85, 45.54, -116.92, 49.00),
    "WV": (-82.64, 37.20, -77.72, 40.64),
    "WI": (-92.89, 42.49, -86.80, 47.31),
    "WY": (-111.06, 40.99, -104.05, 45.01),
    "DC": (-77.12, 38.79, -76.91, 38.99),
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
