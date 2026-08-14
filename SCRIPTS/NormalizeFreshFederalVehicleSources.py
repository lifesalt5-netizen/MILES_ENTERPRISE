from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(r"D:\P2GC_Intelligence\GOVERNMENT_CONTRACTOR_TRUTH")
RAW = ROOT / "RAW_FRESH_VEHICLES"
OUT = ROOT / "NORMALIZED_VEHICLES"
OUT.mkdir(parents=True, exist_ok=True)

FIELDS = [
    "vehicle",
    "contract_number",
    "uei",
    "cage",
    "company",
    "dba",
    "contact_name",
    "email",
    "phone",
    "website",
    "address1",
    "address2",
    "city",
    "state",
    "zip",
    "source_file",
    "source_sheet",
]


def clean(v):
    if pd.isna(v):
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def norm_uei(v):
    return re.sub(r"[^A-Z0-9]", "", clean(v).upper())


def pick(row, names):
    for n in names:
        if n in row and clean(row.get(n)):
            return clean(row.get(n))
    return ""


def write_rows(name, rows):
    path = OUT / f"{name}_NORMALIZED.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})
    return path


def dedupe(rows):
    out = {}
    for r in rows:
        key = (
            r.get("uei")
            or clean(r.get("contract_number")).upper()
            or clean(r.get("company")).upper()
        )
        if not key:
            continue
        if key not in out:
            out[key] = r
            continue
        old = out[key]
        for k in FIELDS:
            if not old.get(k) and r.get(k):
                old[k] = r[k]
    return list(out.values())


def normalize_stars():
    f = RAW / "STARS_III.xlsx"
    df = pd.read_excel(f, dtype=str)
    rows = []
    for _, row in df.iterrows():
        d = row.to_dict()
        rows.append({
            "vehicle": "STARS_III",
            "contract_number": pick(d, ["Contract Number"]),
            "uei": norm_uei(pick(d, ["UEI"])),
            "cage": "",
            "company": pick(d, ["Organization Name"]),
            "dba": pick(d, ["DBA"]),
            "contact_name": pick(d, ["Program Manager"]),
            "email": pick(d, ["S3 Group email address"]).lower(),
            "phone": pick(d, ["Phone Number"]),
            "website": pick(d, ["Company Website"]),
            "address1": pick(d, ["Address 1"]),
            "address2": pick(d, ["Address 2"]),
            "city": pick(d, ["City"]),
            "state": pick(d, ["State"]),
            "zip": pick(d, ["Zip Code"]),
            "source_file": str(f),
            "source_sheet": "",
        })
    return dedupe(rows)


def normalize_alliant2():
    f = RAW / "ALLIANT_2.xlsx"
    df = pd.read_excel(f, dtype=str)
    rows = []
    for _, row in df.iterrows():
        d = row.to_dict()
        rows.append({
            "vehicle": "ALLIANT_2",
            "contract_number": pick(d, ["CONTRACT NUMBER"]),
            "uei": norm_uei(pick(d, ["UEI"])),
            "cage": pick(d, ["CAGE"]),
            "company": pick(d, ["CONTRACTOR NAME"]),
            "dba": "",
            "contact_name": "",
            "email": pick(d, ["GROUP EMAIL"]).lower(),
            "phone": "",
            "website": pick(d, ["WEBSITE URL"]),
            "address1": "",
            "address2": "",
            "city": "",
            "state": "",
            "zip": "",
            "source_file": str(f),
            "source_sheet": "",
        })
    return dedupe(rows)


def normalize_alliant3():
    f = RAW / "ALLIANT_3.csv"
    df = pd.read_csv(f, dtype=str, low_memory=False)
    rows = []
    for _, row in df.iterrows():
        d = row.to_dict()
        company = clean(d.get("field_1"))
        contract = clean(d.get("field_2"))
        phone = clean(d.get("field_3"))
        loc = clean(d.get("field_4"))
        city = ""
        state = ""
        m = re.match(r"^(.*?),\s*([A-Z]{2})$", loc.upper())
        if m:
            city = m.group(1).title()
            state = m.group(2)
        rows.append({
            "vehicle": "ALLIANT_3",
            "contract_number": contract,
            "uei": "",
            "cage": "",
            "company": company,
            "dba": "",
            "contact_name": "",
            "email": "",
            "phone": phone,
            "website": "",
            "address1": "",
            "address2": "",
            "city": city,
            "state": state,
            "zip": "",
            "source_file": str(f),
            "source_sheet": "",
        })
    return dedupe(rows)


def normalize_vets2():
    f = RAW / "VETS_2.xlsx"
    # First row is title; second row contains real headers.
    df = pd.read_excel(f, dtype=str, header=1)
    rows = []
    for _, row in df.iterrows():
        d = row.to_dict()
        city_state_zip = pick(d, ["City/State/Zip"])
        city, state, z = "", "", ""
        m = re.match(r"^(.*?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$", city_state_zip.upper())
        if m:
            city, state, z = m.group(1).title(), m.group(2), m.group(3)
        rows.append({
            "vehicle": "VETS_2",
            "contract_number": pick(d, ["Contract Number"]),
            "uei": norm_uei(pick(d, ["UEI"])),
            "cage": "",
            "company": pick(d, ["Contractor Name"]),
            "dba": "",
            "contact_name": pick(d, ["Program Manager"]),
            "email": pick(d, ["VETS 2 Email"]).lower(),
            "phone": pick(d, ["Phone"]),
            "website": pick(d, ["VETS 2 Webpage"]),
            "address1": pick(d, ["Street Address"]),
            "address2": "",
            "city": city,
            "state": state,
            "zip": z,
            "source_file": str(f),
            "source_sheet": "",
        })
    return dedupe(rows)


def normalize_polaris():
    f = RAW / "POLARIS.xlsx"
    xls = pd.ExcelFile(f)
    rows = []
    used_sheets = []
    for sheet in xls.sheet_names:
        # Try likely header positions because first tab contains directions and pool tabs vary.
        parsed = None
        for header in range(0, 8):
            try:
                df = pd.read_excel(f, sheet_name=sheet, dtype=str, header=header)
            except Exception:
                continue
            cols = [clean(c).upper() for c in df.columns]
            if any("UEI" == c or "SAM UEI" in c for c in cols) and any("CONTRACT" in c for c in cols):
                parsed = df
                break
        if parsed is None:
            continue
        used_sheets.append(sheet)
        for _, row in parsed.iterrows():
            d = row.to_dict()
            rows.append({
                "vehicle": "POLARIS",
                "contract_number": pick(d, ["Contract Number", "CONTRACT NUMBER", "Contract #"]),
                "uei": norm_uei(pick(d, ["UEI", "SAM UEI"])),
                "cage": pick(d, ["CAGE", "CAGE Code"]),
                "company": pick(d, ["Contractor Name", "CONTRACTOR NAME", "Organization Name", "Company Name"]),
                "dba": pick(d, ["DBA"]),
                "contact_name": pick(d, ["Program Manager", "Contact Name"]),
                "email": pick(d, ["Email", "Group Email", "GROUP EMAIL"]).lower(),
                "phone": pick(d, ["Phone", "Phone Number"]),
                "website": pick(d, ["Website", "Website URL", "WEBSITE URL"]),
                "address1": pick(d, ["Address 1", "Street Address"]),
                "address2": pick(d, ["Address 2"]),
                "city": pick(d, ["City"]),
                "state": pick(d, ["State"]),
                "zip": pick(d, ["Zip", "Zip Code", "ZIP"]),
                "source_file": str(f),
                "source_sheet": sheet,
            })
    return dedupe(rows), used_sheets


def main():
    report = []
    jobs = []

    for name, fn in [
        ("STARS_III", normalize_stars),
        ("ALLIANT_2", normalize_alliant2),
        ("ALLIANT_3", normalize_alliant3),
        ("VETS_2", normalize_vets2),
    ]:
        try:
            rows = fn()
            path = write_rows(name, rows)
            report.append({
                "vehicle": name,
                "normalized_rows": len(rows),
                "rows_with_uei": sum(1 for r in rows if r.get("uei")),
                "rows_with_email": sum(1 for r in rows if r.get("email")),
                "status": "NORMALIZED",
                "output": str(path),
                "detail": "",
            })
        except Exception as e:
            report.append({"vehicle": name, "normalized_rows": 0, "rows_with_uei": 0, "rows_with_email": 0, "status": "ERROR", "output": "", "detail": str(e)})

    try:
        rows, sheets = normalize_polaris()
        path = write_rows("POLARIS", rows)
        report.append({
            "vehicle": "POLARIS",
            "normalized_rows": len(rows),
            "rows_with_uei": sum(1 for r in rows if r.get("uei")),
            "rows_with_email": sum(1 for r in rows if r.get("email")),
            "status": "NORMALIZED" if rows else "NO_DATA_SHEETS_FOUND",
            "output": str(path),
            "detail": ";".join(sheets),
        })
    except Exception as e:
        report.append({"vehicle": "POLARIS", "normalized_rows": 0, "rows_with_uei": 0, "rows_with_email": 0, "status": "ERROR", "output": "", "detail": str(e)})

    report_csv = ROOT / "FRESH_VEHICLE_NORMALIZATION_REPORT.csv"
    with report_csv.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["vehicle", "normalized_rows", "rows_with_uei", "rows_with_email", "status", "output", "detail"])
        w.writeheader()
        w.writerows(report)

    report_json = ROOT / "FRESH_VEHICLE_NORMALIZATION_REPORT.json"
    report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("=== FRESH VEHICLE NORMALIZATION ===")
    for r in report:
        print(f"{r['vehicle']:14} {r['status']:24} rows={r['normalized_rows']:<6} uei={r['rows_with_uei']:<6} email={r['rows_with_email']:<6} {r['detail']}")
    print("REPORT:", report_csv)


if __name__ == "__main__":
    main()
