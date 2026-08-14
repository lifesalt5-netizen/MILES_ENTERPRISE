from __future__ import annotations

import csv
import json
import re
from pathlib import Path

INVENTORY = Path(r"D:\P2GC_Intelligence\SOURCE_INVENTORY.csv")
OUT_DIR = Path(r"D:\P2GC_Intelligence\GOVERNMENT_CONTRACTOR_TRUTH")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# We prefer existing local authoritative/production-like sources and only recommend pulls for missing families.
FAMILIES = {
    "SAM_REGISTRY": [r"SAM_PUBLIC_MONTHLY", r"SAM_Registry"],
    "USA_SPENDING_AWARDS": [r"MASTER_PRIME\.csv$", r"contract_awards\.csv$", r"usaspending_prime_awards\.csv$", r"FY20(21|22|23|24|25|26)_All_Contracts"],
    "GSA_MAS": [r"schedule_MAS\.csv$", r"GSA_Schedules"],
    "VA_FSS": [r"va_fss_holders\.csv$", r"VA_FSS_HOLDER\.csv$", r"VA Schedules \.csv$", r"va_master(_enriched)?\.csv$"],
    "NASA_SEWP": [r"SEWP"],
    "OASIS": [r"OASIS"],
    "STARS_III": [r"STARS.?III", r"8\(a\).*STARS", r"8A.*STARS"],
    "POLARIS": [r"POLARIS"],
    "ALLIANT": [r"ALLIANT"],
    "SEAPORT_NXG": [r"SEAPORT", r"NXG"],
    "CIO_SP3": [r"CIO.?SP3"],
    "CIO_SP4": [r"CIO.?SP4"],
    "VETS": [r"VETS.?2", r"VETS"],
    "GWAC_GENERAL": [r"GWAC"],
    "IDIQ_GENERAL": [r"IDIQ"],
    "BPA_GENERAL": [r"BPA"],
    "SBA_SBS": [r"SBS\.csv$", r"SBA", r"Small Business Search", r"Dynamic Small Business Search"],
    "SLED": [r"\\SLED\\", r"STATE_SLED", r"BidNet", r"Bonfire", r"OpenGov", r"IonWave", r"DemandStar", r"PublicPurchase", r"PlanetBids", r"Jaggaer", r"Periscope"],
    "VALIDATED_CONTACTS": [r"VALIDATED_EMAILS", r"VERIFIED", r"INSTANTLY_READY", r"WITH_CONTACTS"],
}

# Priority heuristics. These do not prove authority; they rank candidates for human/system review.
PREFERRED_PATH_MARKERS = [
    "\\ORION_CORE\\",
    "\\ORION_PRODUCTION\\",
    "\\USA_Spending\\OUTPUT\\",
    "\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\",
    "\\CONSOLIDATION OF LEADS\\CLEAN_GSA_VA\\",
]
DEPRIORITIZE_MARKERS = ["\\Backups\\", "\\_ARCHIVE_OLD\\", "\\ARCHIVE_2026_REVIEW\\"]


def score(path: str, size_mb: float, last_write: str) -> float:
    s = min(size_mb, 1000.0) / 100.0
    for m in PREFERRED_PATH_MARKERS:
        if m.lower() in path.lower():
            s += 10
    for m in DEPRIORITIZE_MARKERS:
        if m.lower() in path.lower():
            s -= 15
    if "202603" in path or "2026" in last_write:
        s += 3
    return s


def main():
    if not INVENTORY.exists():
        raise SystemExit(f"Missing inventory: {INVENTORY}")

    rows = []
    with INVENTORY.open("r", encoding="utf-8-sig", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            try:
                size = float(r.get("SizeMB") or 0)
            except Exception:
                size = 0.0
            rows.append({
                "FullName": r.get("FullName", ""),
                "Name": r.get("Name", ""),
                "SizeMB": size,
                "LastWriteTime": r.get("LastWriteTime", ""),
            })

    coverage = []
    missing = []
    for family, patterns in FAMILIES.items():
        rx = [re.compile(p, re.I) for p in patterns]
        matches = [r for r in rows if any(x.search(r["FullName"]) or x.search(r["Name"]) for x in rx)]
        matches.sort(key=lambda r: score(r["FullName"], r["SizeMB"], r["LastWriteTime"]), reverse=True)

        present = bool(matches)
        top = matches[:10]
        coverage.append({
            "family": family,
            "present": present,
            "candidate_count": len(matches),
            "best_candidate": top[0]["FullName"] if top else "",
            "best_size_mb": top[0]["SizeMB"] if top else 0,
            "best_last_write": top[0]["LastWriteTime"] if top else "",
        })
        if not present:
            missing.append(family)

        detail_path = OUT_DIR / f"SOURCE_CANDIDATES_{family}.csv"
        with detail_path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["FullName", "Name", "SizeMB", "LastWriteTime"])
            w.writeheader()
            w.writerows(top)

    with (OUT_DIR / "SOURCE_COVERAGE_REPORT.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(coverage[0].keys()))
        w.writeheader()
        w.writerows(coverage)

    with (OUT_DIR / "SOURCE_COVERAGE_REPORT.json").open("w", encoding="utf-8") as f:
        json.dump({"coverage": coverage, "missing_families": missing}, f, indent=2)

    with (OUT_DIR / "MISSING_SOURCE_PULL_PLAN.txt").open("w", encoding="utf-8") as f:
        if missing:
            f.write("Pull only these source families because no local candidates were found:\n")
            for m in missing:
                f.write(f"- {m}\n")
        else:
            f.write("No source family is completely absent from the local inventory. Validate candidate authority/freshness before using.\n")

    print("=== GOVERNMENT CONTRACTOR TRUTH SOURCE AUDIT ===")
    for r in coverage:
        state = "PRESENT" if r["present"] else "MISSING"
        print(f"{r['family']:<24} {state:<8} candidates={r['candidate_count']:<5} {r['best_candidate']}")
    print("\nMISSING SOURCE FAMILIES:", ", ".join(missing) if missing else "NONE")
    print("REPORT:", OUT_DIR / "SOURCE_COVERAGE_REPORT.csv")
    print("PULL PLAN:", OUT_DIR / "MISSING_SOURCE_PULL_PLAN.txt")


if __name__ == "__main__":
    main()
