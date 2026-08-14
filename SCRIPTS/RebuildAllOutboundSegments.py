from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(r"D:\P2GC_Intelligence\CONSOLIDATION OF LEADS")
ORION_GSA = Path(r"D:\P2GC_Intelligence\ORION_CORE\GSA_Schedules\schedule_MAS.csv")
OUT = ROOT / "REBUILT_SEGMENTS_20260814"
OUT.mkdir(parents=True, exist_ok=True)

# Revenue-first operating rules requested by owner:
# 1) combine all records that qualify for a segment;
# 2) dedupe only inside that segment;
# 3) preserve cross-segment membership, except GSA/VA are not treated as SAM/no-vehicle merely from weak hints;
# 4) certifications/set-asides are attributes and only get one fallback segment if no primary segment applies.

CERT_TERMS = ("8(A)", "8A", "HUBZONE", "WOSB", "EDWOSB", "SDVOSB", "VOSB")
PRIMARY_SEGMENTS = {
    "EXPIRED_EVERYTHING", "EXPIRING_6M", "EXPIRING_12M", "EXPIRING_24M",
    "GSA_NO_SALES", "GSA_0_500K", "GSA_500K_3M", "GSA_3M_5M", "GSA_5M_PLUS",
    "VA_NO_SALES", "VA_0_500K", "VA_500K_3M", "VA_3M_5M", "VA_5M_PLUS",
    "SAM_NO_SALES", "SAM_LOW_SALES", "SAM_GROWTH", "SAM_HIGH_GROWTH",
    "SBS_NO_VEHICLE",
}

ALIASES = {
    "uei": ["uei", "UEI", "SAM UEI", "UEI (Unique Entity Identifier)", "uei_clean"],
    "company": ["legal_name", "Legal_Name", "Vendor", "Business name", "Company Name", "name_clean"],
    "email": ["email", "POC_Email", "Contact person's email", "Email"],
    "phone": ["phone", "Phone", "Phone number"],
    "contact": ["contact_name", "POC_Name", "Contact person's name", "Contact Name"],
    "title": ["contact_title", "POC_Title", "Contact Title"],
    "revenue": ["federal_revenue", "Federal_Revenue", "federal sales", "Federal Sales", "revenue"],
    "segment": ["segment", "Segment", "SEGMENT"],
    "vehicle": ["vehicle", "FED_VEHICLE"],
    "vehicle_hint": ["vehicle_hint", "Vehicle_Hint"],
    "source_files": ["source_files", "Lead_Source", "Source"],
    "state": ["State", "state"],
    "setaside": ["setaside_raw", "Active SBA certifications", "Business type and self-certifications",
                  "8(a) certification status", "HUBZone certification status",
                  "Women-Owned Small Business (WOSB) certification status",
                  "Veteran-Owned Small Business (VOSB) certification status"],
    "exp6": ["expiring_6_months", "expiring_6m"],
    "exp12": ["expiring_12_months", "expiring_12m"],
    "exp24": ["expiring_24_months", "expiring_24m"],
}


def norm(s):
    return re.sub(r"\s+", " ", str(s or "").strip())


def upper(s):
    return norm(s).upper()


def pick(row, key):
    for name in ALIASES[key]:
        if name in row and norm(row.get(name)):
            return norm(row.get(name))
    return ""


def money(v):
    s = norm(v).replace("$", "").replace(",", "")
    if not s:
        return 0.0
    try:
        return float(s)
    except Exception:
        m = re.search(r"-?\d+(?:\.\d+)?", s)
        return float(m.group()) if m else 0.0


def truthy(v):
    return upper(v) in {"1", "TRUE", "YES", "Y", "T"}


def normalize_record(row, source_path):
    rec = {
        "uei": upper(pick(row, "uei")),
        "company": norm(pick(row, "company")),
        "email": upper(pick(row, "email")).lower(),
        "phone": norm(pick(row, "phone")),
        "contact_name": norm(pick(row, "contact")),
        "contact_title": norm(pick(row, "title")),
        "federal_revenue": money(pick(row, "revenue")),
        "original_segment": upper(pick(row, "segment")),
        "vehicle": upper(pick(row, "vehicle")),
        "vehicle_hint": upper(pick(row, "vehicle_hint")),
        "source_files": norm(pick(row, "source_files")),
        "state": upper(pick(row, "state")),
        "source_path": str(source_path),
    }
    cert_blob = " | ".join(norm(row.get(x, "")) for x in ALIASES["setaside"] if x in row)
    rec["certifications"] = cert_blob
    rec["exp6"] = any(truthy(row.get(x)) for x in ALIASES["exp6"] if x in row)
    rec["exp12"] = any(truthy(row.get(x)) for x in ALIASES["exp12"] if x in row)
    rec["exp24"] = any(truthy(row.get(x)) for x in ALIASES["exp24"] if x in row)
    return rec


def lead_key(r):
    # Keep distinct valid contacts at same company; suppress same contact repeated across source files.
    if r["email"]:
        return "EMAIL:" + r["email"]
    if r["uei"] and r["contact_name"]:
        return "UEI_CONTACT:" + r["uei"] + "|" + upper(r["contact_name"])
    if r["uei"]:
        return "UEI:" + r["uei"]
    if r["company"] and r["phone"]:
        return "COMPANY_PHONE:" + upper(r["company"]) + "|" + r["phone"]
    return "COMPANY:" + upper(r["company"]) + "|" + upper(r["contact_name"])


def company_key(r):
    return r["uei"] or upper(r["company"])


def revenue_bucket(prefix, rev):
    if rev <= 0:
        return f"{prefix}_NO_SALES"
    if rev <= 500_000:
        return f"{prefix}_0_500K"
    if rev <= 3_000_000:
        return f"{prefix}_500K_3M"
    if rev <= 5_000_000:
        return f"{prefix}_3M_5M"
    return f"{prefix}_5M_PLUS"


def sam_bucket(r):
    s = r["original_segment"]
    if "SAM_NO_SALES" in s or "ZERO_SALES" in s or r["federal_revenue"] <= 0:
        return "SAM_NO_SALES"
    if "HIGH_GROWTH" in s or r["federal_revenue"] > 5_000_000:
        return "SAM_HIGH_GROWTH"
    if "GROWTH" in s or r["federal_revenue"] > 1_000_000:
        return "SAM_GROWTH"
    return "SAM_LOW_SALES"


def is_certified(r):
    blob = upper(r["certifications"] + " " + r["source_files"] + " " + r["original_segment"])
    return any(term in blob for term in CERT_TERMS)


def add(seg, r, raw_counts, buckets):
    raw_counts[seg] += 1
    buckets[seg].setdefault(lead_key(r), r)


# Authoritative GSA membership uses actual schedule/clean source, not weak vehicle_hint.
gsa_ueis = set()
if ORION_GSA.exists():
    with ORION_GSA.open("r", encoding="utf-8-sig", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            u = upper(row.get("SAM UEI", ""))
            if u:
                gsa_ueis.add(u)

clean_gsa = ROOT / "CLEAN_GSA_VA" / "GSA_CLEAN.csv"
if clean_gsa.exists():
    with clean_gsa.open("r", encoding="utf-8-sig", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            u = upper(row.get("uei", ""))
            if u:
                gsa_ueis.add(u)

# Discover a strong VA/FSS holder source if present. Generic VA_NO_SALES / vehicle_hint is intentionally not trusted.
va_ueis = set()
va_source_files = []
strong_va_patterns = re.compile(r"(VA.*FSS.*HOLDER|FSS.*HOLDER|VA.*SCHEDULE|SCHEDULE.*VA|VA_FSS_HOLDERS|VA_QUALIFIED)", re.I)
for base in [ROOT, Path(r"D:\P2GC_Intelligence\ORION_CORE")]:
    if not base.exists():
        continue
    for p in base.rglob("*.csv"):
        if OUT in p.parents:
            continue
        if strong_va_patterns.search(p.name):
            va_source_files.append(p)
            try:
                with p.open("r", encoding="utf-8-sig", errors="replace", newline="") as f:
                    for row in csv.DictReader(f):
                        u = upper(pick(row, "uei"))
                        if u:
                            va_ueis.add(u)
            except Exception:
                pass

raw_counts = defaultdict(int)
buckets = defaultdict(dict)
files_scanned = 0
rows_scanned = 0
errors = []

for p in ROOT.rglob("*.csv"):
    if OUT in p.parents:
        continue
    # Avoid using known derived corrupt vehicle segment files as proof of GSA/VA membership;
    # they are still scanned for non-vehicle/contact intelligence.
    try:
        with p.open("r", encoding="utf-8-sig", errors="replace", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                continue
            files_scanned += 1
            for row in reader:
                rows_scanned += 1
                r = normalize_record(row, p)
                if not r["uei"] and not r["company"] and not r["email"]:
                    continue

                text = upper(r["original_segment"] + " " + p.stem + " " + r["source_files"])
                is_gsa = bool(r["uei"] and r["uei"] in gsa_ueis)
                is_va = bool(r["uei"] and r["uei"] in va_ueis)

                # Time-signal segments are preserved when explicitly present in source/flags.
                if "EXPIRED_EVERYTHING" in text or "EXPIRED EVERYTHING" in text:
                    add("EXPIRED_EVERYTHING", r, raw_counts, buckets)
                if r["exp6"] or "EXPIRING_6" in text or "6_MONTH" in text:
                    add("EXPIRING_6M", r, raw_counts, buckets)
                if r["exp12"] or "EXPIRING_12" in text or "12_MONTH" in text:
                    add("EXPIRING_12M", r, raw_counts, buckets)
                if r["exp24"] or "EXPIRING_24" in text or "24_MONTH" in text:
                    add("EXPIRING_24M", r, raw_counts, buckets)

                if is_gsa:
                    add(revenue_bucket("GSA", r["federal_revenue"]), r, raw_counts, buckets)
                elif is_va:
                    add(revenue_bucket("VA", r["federal_revenue"]), r, raw_counts, buckets)
                else:
                    # GSA/VA holders are not forced into SAM/no-vehicle. All other overlaps are preserved.
                    sam_signal = (
                        "SAM" in r["vehicle"] or "SAM" in r["original_segment"] or
                        "NON_HOLDER" in text or "NON HOLDERS" in text or
                        "QUALIFIED_PROSPECT_UNIVERSE" in text or "FIRST CONTRACT" in text
                    )
                    if sam_signal:
                        add(sam_bucket(r), r, raw_counts, buckets)

                    if "SBS" in text or "NO_VEHICLE" in text or "NO VEHICLE" in text:
                        add("SBS_NO_VEHICLE", r, raw_counts, buckets)

                # SLED membership is allowed to overlap Federal non-GSA/VA segments.
                sled_signal = "SLED" in text or "STATE_SLED" in text
                if sled_signal:
                    st = r["state"] or "UNKNOWN"
                    add("SLED_" + re.sub(r"[^A-Z0-9]+", "_", st), r, raw_counts, buckets)

                # One combined certification fallback only if record has no primary membership yet.
                if is_certified(r):
                    k = lead_key(r)
                    already_primary = any(k in buckets[s] for s in PRIMARY_SEGMENTS if s in buckets)
                    if not already_primary:
                        add("CERTIFICATION_ONLY", r, raw_counts, buckets)
    except Exception as e:
        errors.append({"file": str(p), "error": str(e)})

# Add ORION GSA schedule contacts directly so source-only GSA records are not lost.
if ORION_GSA.exists():
    try:
        with ORION_GSA.open("r", encoding="utf-8-sig", errors="replace", newline="") as f:
            for row in csv.DictReader(f):
                r = {
                    "uei": upper(row.get("SAM UEI", "")),
                    "company": norm(row.get("Vendor", "")),
                    "email": norm(row.get("Email", "")).lower(),
                    "phone": norm(row.get("Phone", "")),
                    "contact_name": "",
                    "contact_title": "",
                    "federal_revenue": 0.0,
                    "original_segment": "",
                    "vehicle": "GSA",
                    "vehicle_hint": "",
                    "source_files": "schedule_MAS.csv",
                    "state": upper(row.get("State", "")),
                    "source_path": str(ORION_GSA),
                    "certifications": "",
                    "exp6": False, "exp12": False, "exp24": False,
                }
                if r["uei"]:
                    add("GSA_NO_SALES", r, raw_counts, buckets)
    except Exception as e:
        errors.append({"file": str(ORION_GSA), "error": str(e)})

fields = [
    "uei", "company", "email", "phone", "contact_name", "contact_title",
    "federal_revenue", "state", "certifications", "original_segment",
    "vehicle", "vehicle_hint", "source_files", "source_path"
]

summary = []
for seg in sorted(buckets):
    records = list(buckets[seg].values())
    out_file = OUT / f"{seg}.csv"
    with out_file.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)

    companies = {company_key(r) for r in records if company_key(r)}
    emails = {r["email"] for r in records if r["email"]}
    ueis = {r["uei"] for r in records if r["uei"]}
    summary.append({
        "segment": seg,
        "raw_matches": raw_counts[seg],
        "deduped_leads": len(records),
        "unique_companies": len(companies),
        "unique_ueis": len(ueis),
        "leads_with_email": len(emails),
        "output_file": str(out_file),
    })

report_csv = OUT / "SEGMENT_LEAD_REPORT.csv"
with report_csv.open("w", encoding="utf-8-sig", newline="") as f:
    cols = ["segment", "raw_matches", "deduped_leads", "unique_companies", "unique_ueis", "leads_with_email", "output_file"]
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    w.writerows(summary)

report_json = OUT / "SEGMENT_LEAD_REPORT.json"
report_json.write_text(json.dumps({
    "generatedAt": datetime.now().isoformat(),
    "root": str(ROOT),
    "filesScanned": files_scanned,
    "rowsScanned": rows_scanned,
    "gsaAuthoritativeUeis": len(gsa_ueis),
    "vaAuthoritativeUeis": len(va_ueis),
    "vaSourceFiles": [str(x) for x in va_source_files],
    "rules": {
        "dedupeWithinSegmentOnly": True,
        "preserveCrossSegmentMembership": True,
        "gsaVaExcludedFromSamNoVehicleByWeakHints": True,
        "setasidesAreAttributes": True,
        "singleCertificationFallback": True,
    },
    "segments": summary,
    "errors": errors,
}, indent=2), encoding="utf-8")

print("\n=== P2GC SEGMENT REBUILD COMPLETE ===")
print("FILES_SCANNED:", files_scanned)
print("ROWS_SCANNED:", rows_scanned)
print("GSA_AUTHORITATIVE_UEIS:", len(gsa_ueis))
print("VA_FSS_AUTHORITATIVE_UEIS:", len(va_ueis))
if not va_ueis:
    print("WARNING: No populated authoritative VA/FSS holder source was discovered; generic VA hints were NOT trusted.")
print("\nSEGMENT REPORT")
for x in summary:
    print(f"{x['segment']:<24} leads={x['deduped_leads']:<8} companies={x['unique_companies']:<8} emails={x['leads_with_email']:<8}")
print("\nREPORT_CSV:", report_csv)
print("REPORT_JSON:", report_json)
if errors:
    print("FILES_WITH_READ_ERRORS:", len(errors))
