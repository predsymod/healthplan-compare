"""Build the bundled Colorado plan data from the CMS State-Based Exchange QHP PUF.

Usage: python -I scripts/build_co_data.py [plan_year]

Downloads the Colorado SBE PUF zip from CMS, filters to individual-market medical
plans, and writes small JSON files to data/co/. Requires pandas.
"""
import io
import json
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

import pandas as pd

YEAR = sys.argv[1] if len(sys.argv) > 1 else "2026"
URL = f"https://www.cms.gov/files/zip/coloradosbepuf{YEAR}.zip"
OUT = Path(__file__).resolve().parent.parent / "data" / "co"

# Standard plans plus the income-based silver cost-sharing variants. The Zero and
# Limited Cost Sharing variants are for American Indian / Alaska Native enrollees.
KEEP_VARIANTS = ("Standard", "73%", "87%", "94%")

# The CMS file leaves ISSUER NAME blank; names below come from plan marketing and
# network names in the same file. Dental-only issuers are filtered out earlier.
ISSUERS = {
    "21032": "Kaiser Permanente",
    "38283": "Edge",
    "49375": "Cigna",
    "55584": "Select Health",
    "66699": "Elevate Health Plans",
    "76680": "Anthem",
    "97879": "Rocky Mountain Health Plans",
}


def money(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.str.replace(r"[$,]", "", regex=True), errors="coerce")


def read(z: zipfile.ZipFile, marker: str) -> pd.DataFrame:
    name = next(n for n in z.namelist() if marker in n)
    return pd.read_csv(z.open(name), dtype=str)


def main() -> None:
    raw = urllib.request.urlopen(URL).read()
    z = zipfile.ZipFile(io.BytesIO(raw))
    plans, rates, areas = read(z, "Plans"), read(z, "Rates"), read(z, "ServiceAreas")

    plans = plans[
        (plans["MARKET COVERAGE"] == "Individual")
        & (plans["DENTAL ONLY PLAN"] == "No")
        & plans["CSR VARIATION TYPE"].str.startswith(KEEP_VARIANTS)
    ].copy()

    out = pd.DataFrame(
        {
            "id": plans["PLAN ID"],
            "baseId": plans["PLAN ID"].str[:14],
            "issuer": plans["ISSUER ID"].map(ISSUERS),
            "name": plans["PLAN MARKETING NAME"],
            "metal": plans["METAL LEVEL"],
            "variant": plans["CSR VARIATION TYPE"],
            "type": plans["PLAN TYPE"],
            "serviceAreaId": plans["SERVICE AREA ID"],
            "hsa": plans["IS HSA ELIGIBLE"] == "Yes",
            "drugDedIntegrated": plans["MEDICAL DRUG DEDUCTIBLES INTEGRATED"] == "Yes",
            "deductible": money(plans["TEHB DED INN TIER 1 INDIVIDUAL"]),
            "medicalDeductible": money(plans["MEHB DED INN TIER1 INDIVIDUAL"]),
            "drugDeductible": money(plans["DEHB DED INN TIER1 INDIVIDUAL"]),
            "moop": money(plans["TEHB INN TIER 1 INDIVIDUAL MOOP"]),
            "sbcBabyDeductible": money(plans["SBC HAVING A BABY DEDUCTIBLE"]),
            "sbcBabyCopay": money(plans["SBC HAVING A BABY COPAYMENT"]),
            "sbcBabyCoinsurance": money(plans["SBC HAVING A BABY COINSURANCE"]),
            "sbcDiabetesDeductible": money(plans["SBC HAVING DIABETES DEDUCTIBLE"]),
            "sbcDiabetesCopay": money(plans["SBC HAVING  DIABETES COPAYMENT"]),
            "sbcDiabetesCoinsurance": money(plans["SBC HAVING DIABETES COINSURANCE"]),
        }
    )

    base_ids = set(out["baseId"])
    rates = rates[rates["PLAN ID"].isin(base_ids)]
    rate_rows = pd.DataFrame(
        {
            "baseId": rates["PLAN ID"],
            "area": rates["RATING AREA ID"].str.extract(r"(\d+)")[0].astype(int),
            "age": rates["AGE"],
            "rate": pd.to_numeric(rates["INDIVIDUAL RATE"], errors="coerce"),
            "tobaccoRate": pd.to_numeric(rates["INDIVIDUAL TOBACCO RATE"], errors="coerce"),
        }
    ).dropna(subset=["rate"])

    areas = areas[(areas["MARKET COVERAGE"] == "Individual") & (areas["DENTAL PLAN ONLY"] == "No")]
    area_rows = areas[["SERVICE AREA ID", "COVER ENTIRE STATE", "COUNTY", "COUNTY NAME", "PARTIAL COUNTY"]]
    area_rows.columns = ["serviceAreaId", "entireState", "county", "countyName", "partialCounty"]

    OUT.mkdir(parents=True, exist_ok=True)
    out.to_json(OUT / "plans.json", orient="records", indent=0)
    rate_rows.to_json(OUT / "rates.json", orient="records")
    area_rows.to_json(OUT / "serviceAreas.json", orient="records")
    (OUT / "meta.json").write_text(
        json.dumps(
            {
                "state": "CO",
                "exchange": "Connect for Health Colorado",
                "planYear": YEAR,
                "source": URL,
                "retrieved": date.today().isoformat(),
                "plans": len(out),
                "note": "CMS SBE data excludes Colorado state subsidies (Colorado Premium Assistance).",
            },
            indent=2,
        )
    )
    print(f"{len(out)} plans, {len(rate_rows)} rate rows, {len(area_rows)} service-area rows -> {OUT}")


if __name__ == "__main__":
    main()
