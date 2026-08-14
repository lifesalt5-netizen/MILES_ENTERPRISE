from __future__ import annotations

import csv
import json
import re
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(r"D:\P2GC_Intelligence\GOVERNMENT_CONTRACTOR_TRUTH")
RAW = ROOT / "RAW_FRESH_VEHICLES"
RAW.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 P2GC Government Contractor Truth Layer/1.0"
CTX = ssl.create_default_context()

PAGES = {
    "STARS_III": "https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/8a-stars-iii",
    "POLARIS": "https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/polarisr",
    "ALLIANT_2": "https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/alliant-2",
    "ALLIANT_3": "https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/alliant-3",
    "VETS_2": "https://www.gsa.gov/technology/it-contract-vehicles-and-purchasing-programs/gwacs/vets-2",
    "CIO_SP4": "https://nitaac.nih.gov/gwacs/cio-sp4",
}

KEYWORDS = {
    "STARS_III": ["industry partner", "stars iii"],
    "POLARIS": ["industry partner", "polaris"],
    "ALLIANT_2": ["contract holders", "alliant 2"],
    "VETS_2": ["industry partner", "vets"],
}


def fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


def text(url: str) -> str:
    return fetch(url).decode("utf-8", errors="replace")


def discover_xlsx(page_url: str, vehicle: str) -> str | None:
    html = text(page_url)
    candidates = []
    for m in re.finditer(r'href=["\']([^"\']+\.xlsx(?:\?[^"\']*)?)["\']', html, flags=re.I):
        href = unescape(m.group(1))
        start = max(0, m.start() - 250)
        end = min(len(html), m.end() + 250)
        context = re.sub(r"<[^>]+>", " ", html[start:end])
        score = sum(1 for k in KEYWORDS.get(vehicle, []) if k.lower() in context.lower())
        candidates.append((score, urllib.parse.urljoin(page_url, href)))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def save_download(vehicle: str, url: str) -> dict:
    data = fetch(url)
    ext = ".xlsx" if b"PK\x03\x04" in data[:8] else ".bin"
    path = RAW / f"{vehicle}{ext}"
    path.write_bytes(data)
    return {
        "vehicle": vehicle,
        "status": "DOWNLOADED",
        "source_url": url,
        "output": str(path),
        "bytes": len(data),
    }


def pull_alliant3() -> dict:
    # GSA publishes current Alliant 3 holders through eLibrary rather than a direct holder XLSX.
    page = text(PAGES["ALLIANT_3"])
    m = re.search(r'href=["\']([^"\']+)["\'][^>]*>\s*Alliant\s*3\s*contract\s*holders', page, flags=re.I)
    if not m:
        return {"vehicle": "ALLIANT_3", "status": "NO_HOLDER_LINK_FOUND", "source_url": PAGES["ALLIANT_3"]}
    url = urllib.parse.urljoin(PAGES["ALLIANT_3"], unescape(m.group(1)))
    html = text(url)
    # Preserve the official page and extract obvious contractor rows when present.
    raw_html = RAW / "ALLIANT_3_elibrary.html"
    raw_html.write_text(html, encoding="utf-8")
    rows = []
    # eLibrary listing rows generally contain contractor link, contract number and phone/city/state cells.
    for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", html, flags=re.I | re.S):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(c))).strip() for c in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", tr, flags=re.I | re.S)]
        if len(cells) >= 2 and re.search(r"47QT", " ".join(cells), flags=re.I):
            rows.append(cells)
    out_csv = RAW / "ALLIANT_3.csv"
    if rows:
        width = max(map(len, rows))
        with out_csv.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow([f"field_{i+1}" for i in range(width)])
            for r in rows:
                w.writerow(r + [""] * (width - len(r)))
    return {
        "vehicle": "ALLIANT_3",
        "status": "DOWNLOADED_ELIBRARY",
        "source_url": url,
        "output": str(out_csv if rows else raw_html),
        "rows_extracted": len(rows),
    }


def check_cio_sp4() -> dict:
    html = text(PAGES["CIO_SP4"])
    plain = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(html)))
    holder_signal = bool(re.search(r"contract holders|awardees|industry partners", plain, flags=re.I))
    award_signal = bool(re.search(r"award(?:ed|s)?", plain, flags=re.I))
    status = "OFFICIAL_PAGE_HAS_HOLDER_SIGNAL" if holder_signal else "NO_OFFICIAL_HOLDER_LIST_PUBLISHED_ON_PAGE"
    path = RAW / "CIO_SP4_official_page.html"
    path.write_text(html, encoding="utf-8")
    return {
        "vehicle": "CIO_SP4",
        "status": status,
        "source_url": PAGES["CIO_SP4"],
        "award_language_present": award_signal,
        "output": str(path),
    }


def main():
    results = []
    for vehicle in ["STARS_III", "POLARIS", "ALLIANT_2", "VETS_2"]:
        try:
            xlsx = discover_xlsx(PAGES[vehicle], vehicle)
            if not xlsx:
                results.append({"vehicle": vehicle, "status": "NO_XLSX_FOUND", "source_url": PAGES[vehicle]})
                continue
            results.append(save_download(vehicle, xlsx))
        except Exception as e:
            results.append({"vehicle": vehicle, "status": "ERROR", "error": str(e), "source_url": PAGES[vehicle]})

    try:
        results.append(pull_alliant3())
    except Exception as e:
        results.append({"vehicle": "ALLIANT_3", "status": "ERROR", "error": str(e), "source_url": PAGES["ALLIANT_3"]})

    try:
        results.append(check_cio_sp4())
    except Exception as e:
        results.append({"vehicle": "CIO_SP4", "status": "ERROR", "error": str(e), "source_url": PAGES["CIO_SP4"]})

    # General GWAC/IDIQ/BPA membership is not treated as missing external data: derive it from the existing
    # USAspending / prime-award corpus already present locally, preserving parent award and vehicle identifiers.
    results.extend([
        {"vehicle": "GWAC_GENERAL", "status": "DERIVE_FROM_EXISTING_AWARD_CORPUS", "note": "Do not repull awards."},
        {"vehicle": "IDIQ_GENERAL", "status": "DERIVE_FROM_EXISTING_AWARD_CORPUS", "note": "Do not repull awards."},
        {"vehicle": "BPA_GENERAL", "status": "DERIVE_FROM_EXISTING_AWARD_CORPUS", "note": "Do not repull awards."},
    ])

    stamp = datetime.now(timezone.utc).isoformat()
    report = {"generated_at": stamp, "results": results}
    (ROOT / "FRESH_VEHICLE_PULL_REPORT.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    with (ROOT / "FRESH_VEHICLE_PULL_REPORT.csv").open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["vehicle", "status", "source_url", "output", "bytes", "rows_extracted", "award_language_present", "note", "error"]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(results)

    print("=== FRESH FEDERAL VEHICLE PULL ===")
    for r in results:
        print(f"{r['vehicle']:<16} {r['status']:<42} {r.get('output','')}")
    print("REPORT:", ROOT / "FRESH_VEHICLE_PULL_REPORT.csv")


if __name__ == "__main__":
    main()
