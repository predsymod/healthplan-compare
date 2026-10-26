"""Build the Colorado ZIP lookup: ZIP -> county(ies) -> rating area.

Usage: python -I scripts/build_co_zips.py

ZIP-to-county comes from the Census 2020 ZCTA-to-county relationship file. A ZIP can span
counties, so every county is kept with its share of the ZIP's land area. County-to-rating-area
is the CMS table at https://www.cms.gov/cciio/programs-and-initiatives/health-insurance-market-reforms/co-gra
(page last modified 2024-09-10); Colorado's nine areas have been stable since 2015.
"""
import io
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

import pandas as pd

URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
OUT = Path(__file__).resolve().parent.parent / "data" / "co"

AREAS = {
    1: ["Boulder"],
    2: ["El Paso", "Teller"],
    3: ["Adams", "Arapahoe", "Broomfield", "Clear Creek", "Denver", "Douglas", "Elbert", "Gilpin", "Jefferson", "Park"],
    4: ["Larimer"],
    5: ["Mesa"],
    6: ["Weld"],
    7: ["Pueblo"],
    8: ["Alamosa", "Baca", "Bent", "Chaffee", "Cheyenne", "Conejos", "Costilla", "Crowley", "Custer", "Fremont",
        "Huerfano", "Kiowa", "Kit Carson", "Las Animas", "Lincoln", "Logan", "Mineral", "Morgan", "Otero",
        "Phillips", "Prowers", "Rio Grande", "Saguache", "Sedgwick", "Washington", "Yuma"],
    9: ["Archuleta", "Delta", "Dolores", "Eagle", "Garfield", "Grand", "Gunnison", "Hinsdale", "Jackson",
        "La Plata", "Lake", "Moffat", "Montezuma", "Montrose", "Ouray", "Pitkin", "Rio Blanco", "Routt",
        "San Juan", "San Miguel", "Summit"],
}
AREA_OF = {c: a for a, cs in AREAS.items() for c in cs}


def main() -> None:
    raw = urllib.request.urlopen(URL).read().decode("utf-8-sig")
    df = pd.read_csv(io.StringIO(raw), sep="|", dtype=str)
    df = df[df["GEOID_ZCTA5_20"].notna() & df["GEOID_COUNTY_20"].str.startswith("08", na=False)]
    df["land"] = pd.to_numeric(df["AREALAND_PART"])
    df["county"] = df["NAMELSAD_COUNTY_20"].str.replace(" County", "", regex=False)

    missing = set(df["county"]) - set(AREA_OF)
    assert not missing, f"counties without a rating area: {missing}"
    assert len(AREA_OF) == 64

    zips: dict[str, dict] = defaultdict(lambda: {"counties": []})
    for zcta, g in df.groupby("GEOID_ZCTA5_20"):
        total = g["land"].sum() or 1
        zips[zcta]["counties"] = [
            {"fips": r.GEOID_COUNTY_20, "name": r.county, "area": AREA_OF[r.county], "share": round(r.land / total, 3)}
            for r in g.sort_values("land", ascending=False).itertuples()
            if r.land / total >= 0.01
        ]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "zips.json").write_text(json.dumps(zips, separators=(",", ":")))
    (OUT / "ratingAreas.json").write_text(json.dumps(AREAS, indent=1))
    multi = sum(len(v["counties"]) > 1 for v in zips.values())
    print(f"{len(zips)} Colorado ZIP areas, {multi} span more than one county")


if __name__ == "__main__":
    main()
