from pathlib import Path
import json, re
import pandas as pd

ROOT = Path(r"D:\P2GC_Intelligence")
OUT = ROOT / "GOVERNMENT_CONTRACTOR_TRUTH"
TRUTH = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER.csv"
AWARDS = ROOT / "ORION_CORE" / "USA_Spending" / "OUTPUT" / "MASTER_PRIME.csv"
REPORT = OUT / "TRUTH_REVENUE_IDENTITY_DIAGNOSIS.json"


def clean(v):
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except Exception:
        pass
    return str(v).strip()


def norm_uei(v):
    return re.sub(r"[^A-Z0-9]", "", clean(v).upper())


def norm_name(v):
    s = clean(v).upper()
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\b(LLC|INC|CORP|CORPORATION|LTD|LP|LLP|CO|COMPANY)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


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

truth = pd.read_csv(TRUTH, dtype=str, low_memory=False)
aw = pd.read_csv(AWARDS, dtype=str, low_memory=False)

uei_t = pick(truth.columns, ["uei"])
veh_t = pick(truth.columns, ["vehicles", "vehicle_memberships"])
name_t = pick(truth.columns, ["legal_name", "legal name", "company"])

uei_a = pick(aw.columns, ["recipient_uei", "recipient uei", "uei"])
name_a = pick(aw.columns, ["recipient_name", "recipient name", "vendor"])
fy_a = pick(aw.columns, ["action_date_fiscal_year", "fiscal_year", "fiscal year", "fy"])
amt_a = pick(aw.columns, ["federal_action_obligation", "award amount", "obligation", "amount"])

aw["__uei"] = aw[uei_a].map(norm_uei) if uei_a else ""
aw["__name"] = aw[name_a].map(norm_name) if name_a else ""
truth["__uei"] = truth[uei_t].map(norm_uei) if uei_t else ""
truth["__name"] = truth[name_t].map(norm_name) if name_t else ""

# Award FY diagnostics
fy_counts = {}
if fy_a:
    vc = aw[fy_a].astype(str).value_counts(dropna=False).head(20)
    fy_counts = {str(k): int(v) for k, v in vc.items()}

# Check amount parseability and FY2025 availability
amount_parseable = 0
amount_nonzero = 0
if amt_a:
    s = aw[amt_a].astype(str).str.replace(",", "", regex=False).str.replace("$", "", regex=False)
    num = pd.to_numeric(s, errors="coerce")
    amount_parseable = int(num.notna().sum())
    amount_nonzero = int((num.fillna(0) != 0).sum())
else:
    num = pd.Series([0]*len(aw))

fy2025_mask = pd.Series([False]*len(aw))
if fy_a:
    fy2025_mask = aw[fy_a].astype(str).str.contains(r"2025|^25$", regex=True, na=False)

award_uei_set = set(x for x in aw["__uei"] if x)
award_name_set = set(x for x in aw["__name"] if x)

vehicle_stats = {}
vehicles = ["GSA","VA_FSS","SEWP","OASIS","STARS_III","POLARIS","ALLIANT_2","ALLIANT_3","VETS_2","SEAPORT_NXG","CIO_SP3"]
for vehicle in vehicles:
    if not veh_t:
        continue
    sub = truth[truth[veh_t].fillna("").astype(str).str.split(";").apply(lambda xs: vehicle in [x.strip() for x in xs])]
    if len(sub) == 0:
        continue
    with_uei = sub[sub["__uei"] != ""]
    blank_uei = int((sub["__uei"] == "").sum())
    uei_match = int(with_uei["__uei"].isin(award_uei_set).sum())
    name_match = int(sub["__name"].isin(award_name_set).sum())
    # sample unmatched
    sample = sub[(~sub["__uei"].isin(award_uei_set)) & (~sub["__name"].isin(award_name_set))][[c for c in [uei_t,name_t,veh_t] if c]].head(10).to_dict("records")
    vehicle_stats[vehicle] = {
        "companies": int(len(sub)),
        "blank_uei": blank_uei,
        "uei_match": uei_match,
        "uei_match_pct": round((uei_match/len(sub))*100,2),
        "name_match": name_match,
        "name_match_pct": round((name_match/len(sub))*100,2),
        "sample_unmatched": sample,
    }

result = {
    "truth_rows": int(len(truth)),
    "award_rows": int(len(aw)),
    "truth_schema": list(truth.columns),
    "award_schema": list(aw.columns),
    "detected": {"truth_uei": uei_t, "truth_name": name_t, "truth_vehicles": veh_t, "award_uei": uei_a, "award_name": name_a, "award_fy": fy_a, "award_amount": amt_a},
    "fy_top_values": fy_counts,
    "fy2025_rows": int(fy2025_mask.sum()),
    "amount_parseable_rows": amount_parseable,
    "amount_nonzero_rows": amount_nonzero,
    "award_unique_ueis": int(len(award_uei_set)),
    "award_unique_names": int(len(award_name_set)),
    "vehicle_stats": vehicle_stats,
}

REPORT.write_text(json.dumps(result, indent=2), encoding="utf-8")
print("=== TRUTH REVENUE + IDENTITY DIAGNOSIS ===")
print("FY COLUMN:", fy_a)
print("AMOUNT COLUMN:", amt_a)
print("FY2025 ROWS:", result["fy2025_rows"])
print("AMOUNT PARSEABLE:", amount_parseable, "/", len(aw))
print("AMOUNT NONZERO:", amount_nonzero)
print("AWARD UNIQUE UEIS:", result["award_unique_ueis"])
print("\nVEHICLE MATCHES")
for v, s in vehicle_stats.items():
    print(f"{v:<14} companies={s['companies']:<6} blank_uei={s['blank_uei']:<6} uei_match={s['uei_match_pct']:>6.2f}% name_match={s['name_match_pct']:>6.2f}%")
print("REPORT:", REPORT)
