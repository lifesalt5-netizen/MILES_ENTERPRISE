from pathlib import Path
import csv, json, re
import pandas as pd

ROOT = Path(r"D:\P2GC_Intelligence")
OUT = ROOT / "GOVERNMENT_CONTRACTOR_TRUTH"
NORM = OUT / "NORMALIZED_VEHICLES"
OUT.mkdir(parents=True, exist_ok=True)

TRUTH_CSV = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER.csv"
SEGMENT_REPORT = OUT / "GOVERNMENT_CONTRACTOR_SEGMENT_REPORT.csv"
SOURCE_REPORT = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_BUILD_REPORT.json"

REVENUE_BUCKETS = [
    (0, 0, "NO_SALES"),
    (1, 1_000_000, "LOW_SALES"),
    (1_000_001, 3_000_000, "MEDIUM_SALES"),
    (3_000_001, 10_000_000, "HIGH_SALES"),
    (10_000_001, float("inf"), "OVER_10M"),
]

SOURCE_CANDIDATES = {
    "SAM": [
        ROOT / "SAM_Registry" / "SAM_PUBLIC_MONTHLY_V2_20251102.xlsx",
        ROOT / "ORION_CORE" / "SAM_Registry" / "SAM_PUBLIC_MONTHLY_V2_20251102.xlsx",
    ],
    "AWARDS": [
        ROOT / "ORION_CORE" / "USA_Spending" / "OUTPUT" / "MASTER_PRIME.csv",
        ROOT / "USA_Spending" / "OUTPUT" / "MASTER_PRIME.csv",
        ROOT / "Opportunity_Engine" / "Input" / "contract_awards.csv",
    ],
    "GSA": [
        ROOT / "ORION_CORE" / "GSA_Schedules" / "schedule_MAS.csv",
        ROOT / "_ARCHIVE_OLD" / "Good Files to use" / "schedule_MAS.csv",
    ],
    "VA_FSS": [
        ROOT / "SAM_Registry" / "SAM_PUBLIC_MONTHLY_V2_20260301" / "OUT_FILTERED" / "va_fss_holders.csv",
        ROOT / "ORION_CORE" / "SAM_Registry" / "SAM_PUBLIC_MONTHLY_V2_20260301" / "OUT_FILTERED" / "va_fss_holders.csv",
        ROOT / "ARCHIVE_2026_REVIEW" / "VEHICLE_INTELLIGENCE" / "MASTER" / "FULL_VA_FSS_MASTER.csv",
        ROOT / "Opportunity_Engine" / "data_raw" / "va_master_enriched.csv",
    ],
    "SEWP": [ROOT / "ARCHIVE_2026_REVIEW" / "Good Files to use" / "SEWP VENDORS.csv"],
    "OASIS": [ROOT / "ARCHIVE_2026_REVIEW" / "Good Files to use" / "ORION_EXPANSION_ACTUAL_DATA_PULL" / "OTHER_CONTRACT_VEHICLES" / "OASIS_PLUS_Small_Business.csv"],
    "SEAPORT_NXG": [ROOT / "ARCHIVE_2026_REVIEW" / "Good Files to use" / "SEAPORT_NXG_ORION_LAYER" / "SEAPORT_NXG_NORMALIZED.csv"],
    "CIO_SP3": [ROOT / "ARCHIVE_2026_REVIEW" / "Good Files to use" / "ORION_ADDITIONAL_ECOSYSTEMS" / "CIO_SP3_NORMALIZED.csv"],
    "CONTACTS": [
        ROOT / "Opportunity_Engine" / "data" / "P2GC_VALIDATED_EMAILS_FULL.csv",
        ROOT / "Opportunity_Engine" / "data" / "P2GC_VALIDATED_EMAILS.csv",
    ],
}

NORMALIZED_FRESH = {
    "STARS_III": NORM / "STARS_III.csv",
    "POLARIS": NORM / "POLARIS.csv",
    "ALLIANT_2": NORM / "ALLIANT_2.csv",
    "ALLIANT_3": NORM / "ALLIANT_3.csv",
    "VETS_2": NORM / "VETS_2.csv",
}


def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def norm_uei(v):
    return re.sub(r"[^A-Z0-9]", "", clean(v).upper())


def norm_name(v):
    s = clean(v).upper()
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\b(LLC|INC|CORP|CORPORATION|LTD|LP|LLP|CO|COMPANY)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def pick(cols, choices):
    lower = {str(c).strip().lower(): c for c in cols}
    for c in choices:
        if c.lower() in lower:
            return lower[c.lower()]
    for c in choices:
        key = c.lower()
        for lc, real in lower.items():
            if key in lc:
                return real
    return None


def read_any(path):
    if not path or not path.exists():
        return None
    try:
        if path.suffix.lower() == ".csv":
            return pd.read_csv(path, dtype=str, low_memory=False)
        return pd.read_excel(path, dtype=str)
    except Exception:
        return None


def first_present(paths):
    for p in paths:
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def ensure_company(store, uei="", name=""):
    u = norm_uei(uei)
    n = norm_name(name)
    key = u if u else f"NAME::{n}"
    if not u and not n:
        return None
    if key not in store:
        store[key] = {
            "uei": u,
            "cage": "",
            "legal_name": clean(name),
            "dba": "",
            "website": "",
            "address": "",
            "city": "",
            "state": "",
            "zip": "",
            "phone": "",
            "poc_name": "",
            "poc_title": "",
            "email": "",
            "sam_status": "",
            "primary_naics": "",
            "all_naics": "",
            "setaside_attributes": set(),
            "vehicles": set(),
            "vehicle_contracts": set(),
            "fy2022_revenue": 0.0,
            "fy2023_revenue": 0.0,
            "fy2024_revenue": 0.0,
            "fy2025_revenue": 0.0,
            "fy2026_ytd_revenue": 0.0,
            "award_count": 0,
            "top_agencies": set(),
            "sources": set(),
        }
    return store[key]


def merge_identity(rec, row, cols):
    mappings = {
        "uei": ["uei", "sam uei", "unique entity identifier"],
        "cage": ["cage", "cage code"],
        "legal_name": ["legal business name", "legal_name", "legal name", "entity name", "vendor", "contractor name", "organization name", "business name"],
        "dba": ["dba", "doing business as"],
        "website": ["website", "url", "company website", "website url"],
        "address": ["address", "address 1", "street address", "physical address"],
        "city": ["city"],
        "state": ["state"],
        "zip": ["zip", "zip code", "zipcode"],
        "phone": ["phone", "phone number"],
        "poc_name": ["poc name", "contact name", "program manager", "contact person's name"],
        "poc_title": ["poc title", "contact title", "title"],
        "email": ["email", "group email", "group email address", "s3 group email address", "contact person's email"],
        "sam_status": ["registration status", "entity status", "sam status"],
        "primary_naics": ["primary naics", "primary_naics"],
        "all_naics": ["all naics", "all naics codes", "all_naics"],
    }
    for field, options in mappings.items():
        col = pick(cols, options)
        if col:
            val = clean(row.get(col, ""))
            if field == "uei":
                val = norm_uei(val)
            if val and not clean(rec.get(field, "")):
                rec[field] = val


def add_vehicle_file(store, vehicle, path, report):
    df = read_any(path)
    if df is None:
        report.append({"source": vehicle, "path": str(path), "status": "READ_FAILED", "rows": 0})
        return
    ucol = pick(df.columns, ["uei", "sam uei", "unique entity identifier"])
    ncol = pick(df.columns, ["legal_name", "legal name", "vendor", "contractor name", "organization name", "business name", "company name"])
    ccol = pick(df.columns, ["contract number", "contract #", "contract_number"])
    for _, row in df.iterrows():
        u = clean(row.get(ucol, "")) if ucol else ""
        n = clean(row.get(ncol, "")) if ncol else ""
        rec = ensure_company(store, u, n)
        if not rec:
            continue
        merge_identity(rec, row, df.columns)
        rec["vehicles"].add(vehicle)
        rec["sources"].add(str(path))
        if ccol:
            c = clean(row.get(ccol, ""))
            if c:
                rec["vehicle_contracts"].add(f"{vehicle}:{c}")
    report.append({"source": vehicle, "path": str(path), "status": "USED", "rows": len(df)})


def load_sam(store, report):
    path = first_present(SOURCE_CANDIDATES["SAM"])
    if not path:
        report.append({"source": "SAM", "status": "MISSING", "rows": 0})
        return
    df = read_any(path)
    if df is None:
        report.append({"source": "SAM", "path": str(path), "status": "READ_FAILED", "rows": 0})
        return
    ucol = pick(df.columns, ["uei", "unique entity identifier", "sam uei"])
    ncol = pick(df.columns, ["legal business name", "entity name", "legal name", "legal_name", "business name"])
    if not ucol and not ncol:
        report.append({"source": "SAM", "path": str(path), "status": "SCHEMA_UNRESOLVED", "rows": len(df)})
        return
    for _, row in df.iterrows():
        rec = ensure_company(store, clean(row.get(ucol, "")) if ucol else "", clean(row.get(ncol, "")) if ncol else "")
        if rec:
            merge_identity(rec, row, df.columns)
            rec["vehicles"].add("SAM")
            rec["sources"].add(str(path))
            for tag in ["8(a)", "hubzone", "wosb", "edwosb", "sdvosb", "vosb"]:
                for c in df.columns:
                    if tag.replace("(", "").replace(")", "").lower() in str(c).lower():
                        v = clean(row.get(c, "")).lower()
                        if v in {"yes", "y", "true", "1", "active", "certified"}:
                            rec["setaside_attributes"].add(tag.upper())
    report.append({"source": "SAM", "path": str(path), "status": "USED", "rows": len(df)})


def load_awards(store, report):
    path = first_present(SOURCE_CANDIDATES["AWARDS"])
    if not path:
        report.append({"source": "AWARDS", "status": "MISSING", "rows": 0})
        return
    df = read_any(path)
    if df is None:
        report.append({"source": "AWARDS", "path": str(path), "status": "READ_FAILED", "rows": 0})
        return
    ucol = pick(df.columns, ["recipient_uei", "recipient uei", "uei", "sam uei"])
    ncol = pick(df.columns, ["recipient_name", "recipient name", "vendor", "contractor name", "legal_name"])
    acol = pick(df.columns, ["federal_action_obligation", "award amount", "obligation", "amount", "federal_revenue"])
    fycol = pick(df.columns, ["fiscal_year", "fiscal year", "fy"])
    agencycol = pick(df.columns, ["awarding_agency_name", "awarding agency", "agency"])
    if not (ucol or ncol):
        report.append({"source": "AWARDS", "path": str(path), "status": "SCHEMA_UNRESOLVED", "rows": len(df)})
        return
    for _, row in df.iterrows():
        rec = ensure_company(store, clean(row.get(ucol, "")) if ucol else "", clean(row.get(ncol, "")) if ncol else "")
        if not rec:
            continue
        amount = 0.0
        if acol:
            try:
                amount = float(str(row.get(acol, "0")).replace(",", "").replace("$", "") or 0)
            except Exception:
                amount = 0.0
        fy = clean(row.get(fycol, "")) if fycol else ""
        m = re.search(r"20(22|23|24|25|26)", fy)
        if m:
            year = "20" + m.group(1)
            field = f"fy{year}_revenue" if year != "2026" else "fy2026_ytd_revenue"
            rec[field] += amount
        rec["award_count"] += 1
        if agencycol:
            ag = clean(row.get(agencycol, ""))
            if ag:
                rec["top_agencies"].add(ag)
        rec["sources"].add(str(path))
    report.append({"source": "AWARDS", "path": str(path), "status": "USED", "rows": len(df)})


def load_contacts(store, report):
    path = first_present(SOURCE_CANDIDATES["CONTACTS"])
    if not path:
        report.append({"source": "CONTACTS", "status": "MISSING", "rows": 0})
        return
    df = read_any(path)
    if df is None:
        report.append({"source": "CONTACTS", "path": str(path), "status": "READ_FAILED", "rows": 0})
        return
    ucol = pick(df.columns, ["uei", "sam uei", "unique entity identifier"])
    ncol = pick(df.columns, ["legal_name", "legal name", "company", "company name", "business name", "vendor"])
    for _, row in df.iterrows():
        u = clean(row.get(ucol, "")) if ucol else ""
        n = clean(row.get(ncol, "")) if ncol else ""
        rec = ensure_company(store, u, n)
        if rec:
            merge_identity(rec, row, df.columns)
            rec["sources"].add(str(path))
    report.append({"source": "CONTACTS", "path": str(path), "status": "USED", "rows": len(df)})


def revenue_tier(v):
    v = max(float(v or 0), 0.0)
    for lo, hi, name in REVENUE_BUCKETS:
        if lo <= v <= hi:
            return name
    return "OVER_10M"


def behavior(rec):
    vals = [rec["fy2022_revenue"], rec["fy2023_revenue"], rec["fy2024_revenue"], rec["fy2025_revenue"]]
    ytd = rec["fy2026_ytd_revenue"]
    years_with_sales = [i for i, v in enumerate(vals) if v > 0]
    if not years_with_sales and ytd <= 0:
        return "NO_SALES_HISTORY"
    if ytd > 0 and vals[-1] == 0 and any(v > 0 for v in vals[:-1]):
        return "RETURNING"
    if vals[-1] > 0:
        if vals[-2] == 0 and all(v == 0 for v in vals[:-2]):
            return "NEW_ENTRANT"
        if len([v for v in vals[-3:] if v > 0]) >= 2:
            if vals[-1] > vals[-2] > 0:
                return "GROWING"
            if vals[-1] < vals[-2] and vals[-2] > 0:
                return "DECLINING"
        return "ACTIVE"
    if vals[-1] == 0 and vals[-2] == 0 and any(v > 0 for v in vals[:-2]):
        return "DORMANT"
    if vals[-1] == 0 and any(v > 0 for v in vals[:-1]):
        return "LAPSED"
    return "ACTIVE"


def years_without_awards(rec):
    if rec["fy2026_ytd_revenue"] > 0:
        return 0
    if rec["fy2025_revenue"] > 0:
        return 0
    if rec["fy2024_revenue"] > 0:
        return 1
    if rec["fy2023_revenue"] > 0:
        return 2
    if rec["fy2022_revenue"] > 0:
        return 3
    return 4


def build_segments(rec):
    tier = revenue_tier(rec["fy2025_revenue"])
    primary_vehicles = sorted(v for v in rec["vehicles"] if v != "SAM")
    segments = []
    for v in primary_vehicles:
        segments.append(f"{v}_{tier}")
    if "SAM" in rec["vehicles"]:
        segments.append(f"SAM_{tier}")
    if not primary_vehicles and rec["setaside_attributes"]:
        segments.append("CERTIFICATION_ONLY")
    return sorted(set(segments))


def main():
    store = {}
    report = []
    load_sam(store, report)
    load_awards(store, report)

    for vehicle in ["GSA", "VA_FSS", "SEWP", "OASIS", "SEAPORT_NXG", "CIO_SP3"]:
        path = first_present(SOURCE_CANDIDATES[vehicle])
        if path:
            add_vehicle_file(store, vehicle, path, report)
        else:
            report.append({"source": vehicle, "status": "MISSING", "rows": 0})

    for vehicle, path in NORMALIZED_FRESH.items():
        if path.exists() and path.stat().st_size > 0:
            add_vehicle_file(store, vehicle, path, report)
        else:
            report.append({"source": vehicle, "path": str(path), "status": "MISSING", "rows": 0})

    load_contacts(store, report)

    rows = []
    segment_counts = {}
    for rec in store.values():
        segments = build_segments(rec)
        beh = behavior(rec)
        out = {
            "uei": rec["uei"],
            "cage": rec["cage"],
            "legal_name": rec["legal_name"],
            "dba": rec["dba"],
            "website": rec["website"],
            "address": rec["address"],
            "city": rec["city"],
            "state": rec["state"],
            "zip": rec["zip"],
            "phone": rec["phone"],
            "poc_name": rec["poc_name"],
            "poc_title": rec["poc_title"],
            "email": rec["email"],
            "sam_status": rec["sam_status"],
            "primary_naics": rec["primary_naics"],
            "all_naics": rec["all_naics"],
            "setaside_attributes": ";".join(sorted(rec["setaside_attributes"])),
            "vehicle_memberships": ";".join(sorted(rec["vehicles"])),
            "vehicle_contracts": ";".join(sorted(rec["vehicle_contracts"])),
            "fy2022_revenue": round(rec["fy2022_revenue"], 2),
            "fy2023_revenue": round(rec["fy2023_revenue"], 2),
            "fy2024_revenue": round(rec["fy2024_revenue"], 2),
            "fy2025_revenue": round(rec["fy2025_revenue"], 2),
            "fy2026_ytd_revenue": round(rec["fy2026_ytd_revenue"], 2),
            "current_revenue_tier": revenue_tier(rec["fy2025_revenue"]),
            "behavior": beh,
            "years_without_awards": years_without_awards(rec),
            "award_count": rec["award_count"],
            "top_agencies": ";".join(sorted(rec["top_agencies"])[:10]),
            "segments": ";".join(segments),
            "sources": ";".join(sorted(rec["sources"])),
        }
        rows.append(out)
        for s in segments:
            sc = segment_counts.setdefault(s, {"segment": s, "companies": 0, "with_email": 0})
            sc["companies"] += 1
            if rec["email"]:
                sc["with_email"] += 1

    pd.DataFrame(rows).to_csv(TRUTH_CSV, index=False)
    pd.DataFrame(sorted(segment_counts.values(), key=lambda x: (-x["companies"], x["segment"]))).to_csv(SEGMENT_REPORT, index=False)
    build_report = {
        "companies": len(rows),
        "truth_csv": str(TRUTH_CSV),
        "segment_report": str(SEGMENT_REPORT),
        "sources": report,
        "notes": [
            "FY2025 is the current complete-year revenue tier.",
            "FY2026 is retained as YTD and used for behavior detection, not full-year tiering.",
            "Cross-vehicle membership is preserved; dedupe occurs at contractor identity level inside each vehicle segment.",
            "Set-asides are attributes; CERTIFICATION_ONLY is used only when no primary vehicle membership exists.",
            "CIO-SP4 remains excluded until authoritative holder data is available.",
        ],
    }
    SOURCE_REPORT.write_text(json.dumps(build_report, indent=2), encoding="utf-8")

    print("=== GOVERNMENT CONTRACTOR TRUTH MASTER BUILD ===")
    print(f"COMPANIES: {len(rows)}")
    print(f"TRUTH_MASTER: {TRUTH_CSV}")
    print(f"SEGMENT_REPORT: {SEGMENT_REPORT}")
    print(f"BUILD_REPORT: {SOURCE_REPORT}")
    print("\nTOP SEGMENTS")
    for x in sorted(segment_counts.values(), key=lambda x: (-x["companies"], x["segment"]))[:40]:
        print(f"{x['segment']:<38} companies={x['companies']:<8} emails={x['with_email']}")


if __name__ == "__main__":
    main()
