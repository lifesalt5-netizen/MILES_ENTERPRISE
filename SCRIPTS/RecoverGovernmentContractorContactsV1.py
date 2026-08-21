from pathlib import Path
import re, json
import pandas as pd

ROOT = Path(r"D:\P2GC_Intelligence")
OUT = ROOT / "GOVERNMENT_CONTRACTOR_TRUTH"
MASTER = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V6.csv"
OUT_MASTER = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_CONTACTS_V1.csv"
RECOVERY_REPORT = OUT / "GOVERNMENT_CONTRACTOR_CONTACT_RECOVERY_REPORT_V1.csv"
SOURCE_REPORT = OUT / "GOVERNMENT_CONTRACTOR_CONTACT_SOURCE_REPORT_V1.csv"
DETAIL = OUT / "GOVERNMENT_CONTRACTOR_CONTACT_RECOVERY_DETAIL_V1.csv"
JSON_REPORT = OUT / "GOVERNMENT_CONTRACTOR_CONTACT_RECOVERY_V1.json"

TARGET_VEHICLES = {
    "VA_FSS", "OASIS", "SEWP", "STARS_III", "POLARIS", "ALLIANT_2", "ALLIANT_3",
    "VETS_2", "SEAPORT_NXG", "CIO_SP3", "SAM"
}

# Priority order requested: SBA/SBS -> SAM -> State/SLED -> existing validated P2GC contacts.
SOURCE_ROOTS = [
    ("SBA_SBS", ROOT / "CONSOLIDATION OF LEADS" / "MASTER"),
    ("SBA_SBS", ROOT / "ORION_CORE" / "SAM_Registry"),
    ("SAM", ROOT / "SAM_Registry"),
    ("SAM", ROOT / "ORION_CORE" / "SAM_Registry"),
    ("STATE_SLED", ROOT / "SLED"),
    ("STATE_SLED", ROOT / "CONSOLIDATION OF LEADS"),
    ("P2GC_VALIDATED", ROOT / "Opportunity_Engine" / "data"),
    ("P2GC_VALIDATED", ROOT / "ORION_CORE"),
]

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

def clean(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()

def norm_uei(v):
    return re.sub(r"[^A-Z0-9]", "", clean(v).upper())

def norm_name(v):
    s = clean(v).upper()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\bDBA\b.*$", " ", s)
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\b(LLC|INC|CORP|CORPORATION|LTD|LP|LLP|CO|COMPANY|PLLC|PC)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def norm_state(v):
    return clean(v).upper()[:2]

def valid_email(v):
    s = clean(v).lower()
    if not s or not EMAIL_RE.match(s): return ""
    if any(x in s for x in ["example.com", "noreply", "no-reply", "donotreply"]): return ""
    return s

def pick(cols, names):
    low = {str(c).strip().lower(): c for c in cols}
    for n in names:
        if n.lower() in low: return low[n.lower()]
    for n in names:
        q = n.lower()
        for lc, real in low.items():
            if q in lc: return real
    return None

def classify_source(label, path):
    s = str(path).lower()
    if "sbs" in s or "sba" in s: return "SBA_SBS"
    if "sam_registry" in s or "sam_public" in s: return "SAM"
    if "sled" in s or "state" in s or "procurement" in s or "vendor" in s: return "STATE_SLED"
    if "validated" in s or "with_contacts" in s or "email" in s: return "P2GC_VALIDATED"
    return label

def source_priority(label):
    return {"SBA_SBS": 1, "SAM": 2, "STATE_SLED": 3, "P2GC_VALIDATED": 4}.get(label, 9)

def discover_sources():
    candidates = {}
    keywords = re.compile(r"sbs|sba|sam|sled|state|vendor|contact|email|poc|registry", re.I)
    for label, root in SOURCE_ROOTS:
        if not root.exists(): continue
        try:
            for p in root.rglob("*"):
                if not p.is_file() or p.suffix.lower() not in {".csv", ".xlsx"}: continue
                if p.stat().st_size == 0: continue
                if not keywords.search(p.name) and label not in {"SAM", "STATE_SLED"}: continue
                # Avoid huge awards/opportunity files that are not contact registries.
                sl = str(p).lower()
                if any(x in sl for x in ["usa_spending", "all_years_prime", "contract_awards", "subaward"]): continue
                candidates[str(p)] = (classify_source(label, p), p)
        except Exception:
            pass
    return sorted(candidates.values(), key=lambda x: (source_priority(x[0]), str(x[1]).lower()))

def read_source(path):
    try:
        if path.suffix.lower() == ".csv":
            return pd.read_csv(path, dtype=str, low_memory=False)
        return pd.read_excel(path, dtype=str)
    except Exception:
        return None

def parse_contact_rows(df, source_label, source_path):
    cols = list(df.columns)
    ucol = pick(cols, ["uei", "sam uei", "unique entity identifier", "uei (unique entity identifier)"])
    ncol = pick(cols, ["legal_name", "legal name", "legal business name", "business name", "company name", "contractor name", "vendor", "entity name"])
    scol = pick(cols, ["state", "state code", "physical state", "mailing state"])
    ecol = pick(cols, ["email", "poc email", "contact email", "contact person's email", "email address", "e-mail"])
    pcol = pick(cols, ["phone", "phone number", "telephone", "poc phone", "contact phone"])
    ccol = pick(cols, ["contact", "contact name", "poc name", "contact person's name", "program manager", "primary poc name"])
    tcol = pick(cols, ["title", "contact title", "poc title", "job title"])
    wcol = pick(cols, ["website", "url", "company website", "web site"])
    if not ecol: return [], {"status":"NO_EMAIL_COLUMN","rows":len(df)}
    rows=[]
    for _, r in df.iterrows():
        email = valid_email(r.get(ecol, ""))
        if not email: continue
        u = norm_uei(r.get(ucol, "")) if ucol else ""
        name = clean(r.get(ncol, "")) if ncol else ""
        nn = norm_name(name)
        state = norm_state(r.get(scol, "")) if scol else ""
        if not u and not nn: continue
        rows.append({
            "uei":u, "name_norm":nn, "legal_name":name, "state":state,
            "email":email,
            "phone":clean(r.get(pcol, "")) if pcol else "",
            "contact_name":clean(r.get(ccol, "")) if ccol else "",
            "contact_title":clean(r.get(tcol, "")) if tcol else "",
            "website":clean(r.get(wcol, "")) if wcol else "",
            "contact_source":source_label,
            "source_path":str(source_path),
            "priority":source_priority(source_label),
        })
    return rows, {"status":"USED","rows":len(df),"usable_contacts":len(rows)}

if not MASTER.exists():
    raise SystemExit(f"Missing required V6 Truth Master: {MASTER}")

m = pd.read_csv(MASTER, dtype=str, low_memory=False).fillna("")
if "vehicle_memberships" not in m.columns:
    raise SystemExit("V6 master missing vehicle_memberships column")

m["uei"] = m["uei"].map(norm_uei)
m["_name"] = m["legal_name"].map(norm_name)
m["_state"] = m["state"].map(norm_state) if "state" in m.columns else ""
m["email"] = m["email"].map(valid_email) if "email" in m.columns else ""

# Only recover contacts for target federal/SAM rows that are currently missing an email.
target_mask = m["vehicle_memberships"].map(lambda x: any(v in TARGET_VEHICLES for v in [z.strip() for z in clean(x).split(";") if z.strip()]))
missing_before = target_mask & m["email"].eq("")

contacts=[]
source_stats=[]
for label, path in discover_sources():
    df=read_source(path)
    if df is None:
        source_stats.append({"source":label,"path":str(path),"status":"READ_FAILED","rows":0,"usable_contacts":0})
        continue
    parsed, st = parse_contact_rows(df,label,path)
    st.update({"source":label,"path":str(path)})
    source_stats.append(st)
    contacts.extend(parsed)

# Deduplicate exact source contact rows, preserving best-priority records.
contact_df = pd.DataFrame(contacts)
if len(contact_df):
    contact_df.sort_values(["priority","source_path"], inplace=True)
    contact_df.drop_duplicates(subset=["uei","name_norm","state","email"], keep="first", inplace=True)

by_uei={}
by_name_state={}
by_name={}
if len(contact_df):
    for _,r in contact_df.iterrows():
        d=r.to_dict()
        if d["uei"]: by_uei.setdefault(d["uei"],[]).append(d)
        if d["name_norm"] and d["state"]: by_name_state.setdefault((d["name_norm"],d["state"]),[]).append(d)
        if d["name_norm"]: by_name.setdefault(d["name_norm"],[]).append(d)

recovery=[]
for i in m.index[missing_before]:
    u=m.at[i,"uei"]; nn=m.at[i,"_name"]; st=m.at[i,"_state"]
    candidates=[]; method=""
    if u and u in by_uei:
        candidates=by_uei[u]; method="UEI"
    elif nn and st and (nn,st) in by_name_state:
        candidates=by_name_state[(nn,st)]; method="NAME_STATE"
    elif nn and nn in by_name:
        # Only allow name-only when all available candidates point to one unique email.
        uniq={x["email"] for x in by_name[nn]}
        if len(uniq)==1:
            candidates=by_name[nn]; method="NAME_UNIQUE"
    if not candidates: continue
    candidates=sorted(candidates,key=lambda x:(x["priority"], 0 if x["contact_name"] else 1, x["email"]))
    best=candidates[0]
    m.at[i,"email"]=best["email"]
    if "phone" in m.columns and not clean(m.at[i,"phone"]): m.at[i,"phone"]=best["phone"]
    if "poc_name" in m.columns and not clean(m.at[i,"poc_name"]): m.at[i,"poc_name"]=best["contact_name"]
    if "poc_title" in m.columns and not clean(m.at[i,"poc_title"]): m.at[i,"poc_title"]=best["contact_title"]
    if "website" in m.columns and not clean(m.at[i,"website"]): m.at[i,"website"]=best["website"]
    recovery.append({
        "row_index":int(i),"uei":u,"legal_name":m.at[i,"legal_name"],"state":st,
        "vehicle_memberships":m.at[i,"vehicle_memberships"],"email":best["email"],
        "phone":best["phone"],"contact_name":best["contact_name"],"contact_title":best["contact_title"],
        "contact_source":best["contact_source"],"match_method":method,"source_path":best["source_path"]
    })

m.drop(columns=["_name","_state"], inplace=True)
m.to_csv(OUT_MASTER,index=False)
pd.DataFrame(recovery).to_csv(DETAIL,index=False)
pd.DataFrame(source_stats).to_csv(SOURCE_REPORT,index=False)

# Report before/after by vehicle.
rows=[]
for vehicle in sorted(TARGET_VEHICLES):
    mask=m["vehicle_memberships"].map(lambda x: vehicle in [z.strip() for z in clean(x).split(";") if z.strip()])
    total=int(mask.sum())
    after=int((mask & m["email"].ne("")).sum())
    # Reconstruct before as after minus recoveries for this vehicle.
    recovered=sum(1 for r in recovery if vehicle in [z.strip() for z in clean(r["vehicle_memberships"]).split(";") if z.strip()])
    before=max(0,after-recovered)
    rows.append({"vehicle":vehicle,"companies":total,"emails_before":before,"recovered":recovered,"emails_after":after,"coverage_after_pct":round((after/total*100),2) if total else 0})
pd.DataFrame(rows).to_csv(RECOVERY_REPORT,index=False)

summary={
    "companies":len(m),
    "target_rows":int(target_mask.sum()),
    "target_missing_email_before":int(missing_before.sum()),
    "contacts_discovered":int(len(contact_df)) if len(contact_df) else 0,
    "emails_recovered":len(recovery),
    "output_master":str(OUT_MASTER),
    "recovery_report":str(RECOVERY_REPORT),
    "source_report":str(SOURCE_REPORT),
    "detail":str(DETAIL),
    "rules":[
        "SBA/SBS > SAM > State/SLED > existing validated P2GC contact sources",
        "UEI match first; exact normalized legal name + state second; unique exact name third",
        "Set-asides are attributes only; no standalone set-aside segments are created",
        "Recovered emails are not considered verified for sending until downstream MillionVerifier validation"
    ]
}
JSON_REPORT.write_text(json.dumps(summary,indent=2),encoding="utf-8")

print("=== GOVERNMENT CONTRACTOR CONTACT RECOVERY V1 ===")
for k,v in summary.items():
    if k!="rules": print(f"{k}: {v}")
print("\nCONTACT COVERAGE BY VEHICLE")
for r in rows:
    print(f"{r['vehicle']:<14} companies={r['companies']:<7} before={r['emails_before']:<7} recovered={r['recovered']:<7} after={r['emails_after']:<7} coverage={r['coverage_after_pct']:>6.2f}%")
