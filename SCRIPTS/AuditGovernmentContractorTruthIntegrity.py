from pathlib import Path
import json, re
import pandas as pd

ROOT = Path(r"D:\P2GC_Intelligence")
OUT = ROOT / "GOVERNMENT_CONTRACTOR_TRUTH"
TRUTH = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER.csv"
REPORT_CSV = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_INTEGRITY_REPORT.csv"
REPORT_JSON = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_INTEGRITY_REPORT.json"
UNMATCHED_CSV = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_UNMATCHED_UEI.csv"

AWARD_CANDIDATES = [
    ROOT / "ORION_CORE" / "USA_Spending" / "OUTPUT" / "MASTER_PRIME.csv",
    ROOT / "USA_Spending" / "OUTPUT" / "MASTER_PRIME.csv",
    ROOT / "Opportunity_Engine" / "Input" / "contract_awards.csv",
]

VEHICLES = ["GSA","VA_FSS","SEWP","OASIS","SEAPORT_NXG","CIO_SP3","STARS_III","POLARIS","ALLIANT_2","ALLIANT_3","VETS_2"]


def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def norm_uei(v):
    return re.sub(r"[^A-Z0-9]", "", clean(v).upper())


def split_vehicles(v):
    s = clean(v)
    if not s:
        return set()
    return {x.strip().upper() for x in re.split(r"[;|,]", s) if x.strip()}


def num(series):
    return pd.to_numeric(series, errors="coerce").fillna(0.0)


def first_existing(paths):
    for p in paths:
        if p.exists() and p.stat().st_size > 0:
            return p
    return None


def pick(cols, choices):
    low = {str(c).strip().lower(): c for c in cols}
    for x in choices:
        if x.lower() in low:
            return low[x.lower()]
    for x in choices:
        for lc, real in low.items():
            if x.lower() in lc:
                return real
    return None

if not TRUTH.exists():
    raise SystemExit(f"Truth master missing: {TRUTH}")

truth = pd.read_csv(TRUTH, dtype=str, low_memory=False)
truth.columns = [str(c).strip() for c in truth.columns]

uei_col = pick(truth.columns, ["uei", "sam uei", "unique entity identifier"])
veh_col = pick(truth.columns, ["vehicles", "vehicle_memberships", "contract vehicles"])
email_col = pick(truth.columns, ["email", "contact email"])
name_col = pick(truth.columns, ["legal_name", "legal name", "company", "vendor"])

fy_fields = {}
for y in [2022, 2023, 2024, 2025]:
    fy_fields[y] = pick(truth.columns, [f"fy{y}_revenue", f"{y}_revenue", f"fy{y}"])
fy2026 = pick(truth.columns, ["fy2026_ytd_revenue", "fy2026_revenue", "2026_revenue"])

truth["__uei"] = truth[uei_col].map(norm_uei) if uei_col else ""
truth["__vehicles"] = truth[veh_col].map(split_vehicles) if veh_col else [set() for _ in range(len(truth))]
truth["__has_email"] = truth[email_col].fillna("").astype(str).str.strip().ne("") if email_col else False
for y,c in fy_fields.items():
    truth[f"__fy{y}"] = num(truth[c]) if c else 0.0
truth["__fy2026"] = num(truth[fy2026]) if fy2026 else 0.0
truth["__hist_total"] = sum(truth[f"__fy{y}"] for y in [2022,2023,2024,2025]) + truth["__fy2026"]

award_path = first_existing(AWARD_CANDIDATES)
award_uei = set()
award_rows = 0
award_schema = {}
if award_path:
    awards = pd.read_csv(award_path, dtype=str, low_memory=False)
    award_rows = len(awards)
    au = pick(awards.columns, ["recipient_uei", "recipient uei", "uei", "sam uei"])
    an = pick(awards.columns, ["recipient_name", "recipient name", "vendor", "contractor name", "legal_name"])
    afy = pick(awards.columns, ["fiscal_year", "fiscal year", "fy"])
    aamt = pick(awards.columns, ["federal_action_obligation", "award amount", "obligation", "amount", "federal_revenue"])
    award_schema = {"uei_col": au, "name_col": an, "fy_col": afy, "amount_col": aamt}
    if au:
        award_uei = {norm_uei(x) for x in awards[au].dropna().astype(str) if norm_uei(x)}

rows = []
unmatched_records = []

def add(scope, companies, matched_award, revenue_pos, email_count, blank_uei):
    rows.append({
        "scope": scope,
        "companies": int(companies),
        "award_uei_matches": int(matched_award),
        "award_match_pct": round((matched_award/companies*100),2) if companies else 0,
        "companies_with_any_revenue": int(revenue_pos),
        "revenue_coverage_pct": round((revenue_pos/companies*100),2) if companies else 0,
        "companies_with_email": int(email_count),
        "email_coverage_pct": round((email_count/companies*100),2) if companies else 0,
        "blank_uei": int(blank_uei),
    })

base = truth
matched = base["__uei"].isin(award_uei) if award_uei else pd.Series(False, index=base.index)
add("ALL", len(base), matched.sum(), (base["__hist_total"]>0).sum(), base["__has_email"].sum(), base["__uei"].eq("").sum())

for vehicle in VEHICLES:
    mask = truth["__vehicles"].map(lambda s: vehicle in s)
    df = truth[mask]
    if df.empty:
        continue
    mm = df["__uei"].isin(award_uei) if award_uei else pd.Series(False, index=df.index)
    add(vehicle, len(df), mm.sum(), (df["__hist_total"]>0).sum(), df["__has_email"].sum(), df["__uei"].eq("").sum())
    bad = df[(df["__uei"]!="") & (~mm)]
    for _,r in bad.head(5000).iterrows():
        unmatched_records.append({
            "vehicle": vehicle,
            "uei": r["__uei"],
            "legal_name": clean(r[name_col]) if name_col else "",
            "email": clean(r[email_col]) if email_col else "",
        })

report = pd.DataFrame(rows)
report.to_csv(REPORT_CSV, index=False)
pd.DataFrame(unmatched_records).drop_duplicates().to_csv(UNMATCHED_CSV, index=False)

summary = {
    "truth_master": str(TRUTH),
    "truth_companies": len(truth),
    "award_source": str(award_path) if award_path else None,
    "award_rows": award_rows,
    "award_schema": award_schema,
    "truth_schema": {
        "uei_col": uei_col,
        "vehicles_col": veh_col,
        "email_col": email_col,
        "name_col": name_col,
        "fy_fields": fy_fields,
        "fy2026": fy2026,
    },
    "report_csv": str(REPORT_CSV),
    "unmatched_csv": str(UNMATCHED_CSV),
}
REPORT_JSON.write_text(json.dumps(summary, indent=2), encoding="utf-8")

print("=== GOVERNMENT CONTRACTOR TRUTH INTEGRITY AUDIT ===")
print(f"TRUTH_COMPANIES: {len(truth)}")
print(f"AWARD_SOURCE: {award_path}")
print(f"AWARD_ROWS: {award_rows}")
print(f"AWARD_SCHEMA: {award_schema}")
print("\nCOVERAGE BY VEHICLE")
for _,r in report.iterrows():
    print(f"{r['scope']:<14} companies={int(r['companies']):<7} award_match={r['award_match_pct']:>6.2f}% revenue={r['revenue_coverage_pct']:>6.2f}% email={r['email_coverage_pct']:>6.2f}% blank_uei={int(r['blank_uei'])}")
print(f"\nREPORT: {REPORT_CSV}")
print(f"UNMATCHED: {UNMATCHED_CSV}")
