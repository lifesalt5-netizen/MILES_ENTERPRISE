from pathlib import Path
import re, json
import pandas as pd

ROOT = Path(r"D:\P2GC_Intelligence")
OUT = ROOT / "GOVERNMENT_CONTRACTOR_TRUTH"
MASTER = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V8.csv"
PRIOR_CONTACT_MASTER = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_CONTACTS_V1.csv"
OUT_MASTER = OUT / "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_CONTACTS_V2.csv"
DETAIL = OUT / "NEW_VEHICLE_CONTACT_RECOVERY_DETAIL_V2.csv"
REPORT = OUT / "NEW_VEHICLE_CONTACT_RECOVERY_REPORT_V2.csv"
SOURCE_REPORT = OUT / "NEW_VEHICLE_CONTACT_SOURCE_REPORT_V2.csv"
JSON_REPORT = OUT / "NEW_VEHICLE_CONTACT_RECOVERY_V2.json"

TARGET_VEHICLES = {"POLARIS", "ALLIANT_3"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# Priority: recovered/validated P2GC contact history first only as a reusable cache,
# then SBA/SBS -> SAM -> State/SLED -> other validated P2GC sources.
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

def norm_state(v): return clean(v).upper()[:2]

def valid_email(v):
    s = clean(v).lower()
    if not s or not EMAIL_RE.match(s): return ""
    if any(x in s for x in ["example.com", "noreply", "no-reply", "donotreply"]): return ""
    return s

def split_vehicles(v): return {x.strip() for x in clean(v).split(";") if x.strip()}

def pick(cols, names):
    low = {str(c).strip().lower(): c for c in cols}
    for n in names:
        if n.lower() in low: return low[n.lower()]
    for n in names:
        q=n.lower()
        for lc,real in low.items():
            if q in lc: return real
    return None

def source_priority(label):
    return {"P2GC_CACHE":0,"SBA_SBS":1,"SAM":2,"STATE_SLED":3,"P2GC_VALIDATED":4}.get(label,9)

def classify_source(label,path):
    s=str(path).lower()
    if "sbs" in s or "sba" in s: return "SBA_SBS"
    if "sam_registry" in s or "sam_public" in s: return "SAM"
    if "sled" in s or "state" in s or "procurement" in s or "vendor" in s: return "STATE_SLED"
    if "validated" in s or "with_contacts" in s or "email" in s: return "P2GC_VALIDATED"
    return label

def read_any(path):
    try:
        if path.suffix.lower()==".csv": return pd.read_csv(path,dtype=str,low_memory=False)
        return pd.read_excel(path,dtype=str)
    except Exception:
        return None

def parse_contacts(df,label,path,target_ueis,target_names,target_name_states):
    cols=list(df.columns)
    ucol=pick(cols,["uei","sam uei","unique entity identifier","uei (unique entity identifier)"])
    ncol=pick(cols,["legal_name","legal name","legal business name","business name","company name","contractor name","vendor","entity name"])
    scol=pick(cols,["state","state code","physical state","mailing state"])
    ecol=pick(cols,["email","poc email","contact email","contact person's email","email address","e-mail"])
    pcol=pick(cols,["phone","phone number","telephone","poc phone","contact phone"])
    ccol=pick(cols,["contact","contact name","poc name","contact person's name","program manager","primary poc name"])
    tcol=pick(cols,["title","contact title","poc title","job title"])
    wcol=pick(cols,["website","url","company website","web site"])
    if not ecol: return [],"NO_EMAIL_COLUMN"
    out=[]
    for _,r in df.iterrows():
        email=valid_email(r.get(ecol,""))
        if not email: continue
        u=norm_uei(r.get(ucol,"")) if ucol else ""
        name=clean(r.get(ncol,"")) if ncol else ""
        nn=norm_name(name)
        st=norm_state(r.get(scol,"")) if scol else ""
        # Since this is a targeted pass, retain only contacts capable of matching a target.
        if not ((u and u in target_ueis) or (nn and nn in target_names) or (nn and st and (nn,st) in target_name_states)):
            continue
        out.append({
            "uei":u,"name_norm":nn,"state":st,"email":email,
            "phone":clean(r.get(pcol,"")) if pcol else "",
            "contact_name":clean(r.get(ccol,"")) if ccol else "",
            "contact_title":clean(r.get(tcol,"")) if tcol else "",
            "website":clean(r.get(wcol,"")) if wcol else "",
            "contact_source":label,"source_path":str(path),"priority":source_priority(label)
        })
    return out,"USED"

if not MASTER.exists(): raise SystemExit(f"Missing V8 master: {MASTER}")
m=pd.read_csv(MASTER,dtype=str,low_memory=False).fillna("")
m["uei"]=m["uei"].map(norm_uei)
m["_name"]=m["legal_name"].map(norm_name)
m["_state"]=m["state"].map(norm_state) if "state" in m.columns else ""
m["email"]=m["email"].map(valid_email) if "email" in m.columns else ""

target_mask=m["vehicle_memberships"].map(lambda x: bool(split_vehicles(x)&TARGET_VEHICLES))
missing_mask=target_mask & m["email"].eq("")
target_idx=list(m.index[missing_mask])
target_ueis={m.at[i,"uei"] for i in target_idx if m.at[i,"uei"]}
target_names={m.at[i,"_name"] for i in target_idx if m.at[i,"_name"]}
target_name_states={(m.at[i,"_name"],m.at[i,"_state"]) for i in target_idx if m.at[i,"_name"] and m.at[i,"_state"]}

contacts=[]
source_stats=[]

# Fast reusable cache from the prior recovery output.
if PRIOR_CONTACT_MASTER.exists():
    p=pd.read_csv(PRIOR_CONTACT_MASTER,dtype=str,low_memory=False).fillna("")
    p["uei"]=p["uei"].map(norm_uei); p["_name"]=p["legal_name"].map(norm_name)
    p["_state"]=p["state"].map(norm_state) if "state" in p.columns else ""
    for _,r in p.iterrows():
        email=valid_email(r.get("email",""))
        if not email: continue
        u=r["uei"]; nn=r["_name"]; st=r["_state"]
        if not ((u and u in target_ueis) or (nn and nn in target_names) or (nn and st and (nn,st) in target_name_states)): continue
        contacts.append({"uei":u,"name_norm":nn,"state":st,"email":email,"phone":clean(r.get("phone","")),"contact_name":clean(r.get("poc_name","")),"contact_title":clean(r.get("poc_title","")),"website":clean(r.get("website","")),"contact_source":"P2GC_CACHE","source_path":str(PRIOR_CONTACT_MASTER),"priority":0})
    source_stats.append({"source":"P2GC_CACHE","path":str(PRIOR_CONTACT_MASTER),"status":"USED","usable_contacts":len(contacts)})

keywords=re.compile(r"sbs|sba|sam|sled|state|vendor|contact|email|poc|registry",re.I)
seen=set()
for label,root in SOURCE_ROOTS:
    if not root.exists(): continue
    try:
        paths=list(root.rglob("*"))
    except Exception:
        continue
    for path in paths:
        if not path.is_file() or path.suffix.lower() not in {".csv",".xlsx"} or path.stat().st_size==0: continue
        sp=str(path)
        if sp in seen: continue
        seen.add(sp)
        if not keywords.search(path.name) and label not in {"SAM","STATE_SLED"}: continue
        sl=sp.lower()
        if any(x in sl for x in ["usa_spending","all_years_prime","contract_awards","subaward"]): continue
        real_label=classify_source(label,path)
        df=read_any(path)
        if df is None:
            source_stats.append({"source":real_label,"path":sp,"status":"READ_FAILED","usable_contacts":0}); continue
        parsed,status=parse_contacts(df,real_label,path,target_ueis,target_names,target_name_states)
        contacts.extend(parsed)
        source_stats.append({"source":real_label,"path":sp,"status":status,"usable_contacts":len(parsed)})

cdf=pd.DataFrame(contacts)
if len(cdf):
    cdf.sort_values(["priority","source_path"],inplace=True)
    cdf.drop_duplicates(subset=["uei","name_norm","state","email"],keep="first",inplace=True)
by_uei={}; by_ns={}; by_n={}
if len(cdf):
    for _,r in cdf.iterrows():
        d=r.to_dict()
        if d["uei"]: by_uei.setdefault(d["uei"],[]).append(d)
        if d["name_norm"] and d["state"]: by_ns.setdefault((d["name_norm"],d["state"]),[]).append(d)
        if d["name_norm"]: by_n.setdefault(d["name_norm"],[]).append(d)

recovery=[]
for i in target_idx:
    u=m.at[i,"uei"]; nn=m.at[i,"_name"]; st=m.at[i,"_state"]
    cand=[]; method=""
    if u and u in by_uei: cand=by_uei[u]; method="UEI"
    elif nn and st and (nn,st) in by_ns: cand=by_ns[(nn,st)]; method="NAME_STATE"
    elif nn and nn in by_n:
        uniq={x["email"] for x in by_n[nn]}
        if len(uniq)==1: cand=by_n[nn]; method="NAME_UNIQUE"
    if not cand: continue
    cand=sorted(cand,key=lambda x:(x["priority"],0 if x["contact_name"] else 1,x["email"]))
    best=cand[0]
    m.at[i,"email"]=best["email"]
    if "phone" in m.columns and not clean(m.at[i,"phone"]): m.at[i,"phone"]=best["phone"]
    if "poc_name" in m.columns and not clean(m.at[i,"poc_name"]): m.at[i,"poc_name"]=best["contact_name"]
    if "poc_title" in m.columns and not clean(m.at[i,"poc_title"]): m.at[i,"poc_title"]=best["contact_title"]
    if "website" in m.columns and not clean(m.at[i,"website"]): m.at[i,"website"]=best["website"]
    recovery.append({"row_index":int(i),"uei":u,"legal_name":m.at[i,"legal_name"],"state":st,"vehicle_memberships":m.at[i,"vehicle_memberships"],"email":best["email"],"contact_source":best["contact_source"],"match_method":method,"source_path":best["source_path"]})

m.drop(columns=["_name","_state"],inplace=True)
m.to_csv(OUT_MASTER,index=False)
pd.DataFrame(recovery).to_csv(DETAIL,index=False)
pd.DataFrame(source_stats).to_csv(SOURCE_REPORT,index=False)

rows=[]
for vehicle in sorted(TARGET_VEHICLES):
    mask=m["vehicle_memberships"].map(lambda x: vehicle in split_vehicles(x))
    total=int(mask.sum()); after=int((mask & m["email"].ne("")).sum())
    recovered=sum(1 for r in recovery if vehicle in split_vehicles(r["vehicle_memberships"]))
    before=max(0,after-recovered)
    rows.append({"vehicle":vehicle,"companies":total,"emails_before":before,"recovered":recovered,"emails_after":after,"missing_after":total-after,"coverage_after_pct":round(after/total*100,2) if total else 0})
pd.DataFrame(rows).to_csv(REPORT,index=False)

summary={"companies":len(m),"target_rows":int(target_mask.sum()),"target_missing_before":int(missing_mask.sum()),"candidate_contacts":int(len(cdf)) if len(cdf) else 0,"emails_recovered":len(recovery),"output_master":str(OUT_MASTER),"detail":str(DETAIL),"report":str(REPORT),"source_report":str(SOURCE_REPORT),"verification_required":True}
JSON_REPORT.write_text(json.dumps(summary,indent=2),encoding="utf-8")
print("=== NEW VEHICLE CONTACT RECOVERY V2 ===")
for k,v in summary.items(): print(f"{k}: {v}")
print("\nCONTACT COVERAGE")
for r in rows:
    print(f"{r['vehicle']:<12} companies={r['companies']:<4} before={r['emails_before']:<4} recovered={r['recovered']:<4} after={r['emails_after']:<4} missing={r['missing_after']:<4} coverage={r['coverage_after_pct']:>6.2f}%")
