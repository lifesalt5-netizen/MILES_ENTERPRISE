from pathlib import Path
import re, json
import pandas as pd

ROOT=Path(r'D:\P2GC_Intelligence')
OUT=ROOT/'GOVERNMENT_CONTRACTOR_TRUTH'
V4=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V4.csv'
BASE=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER.csv'
OUT5=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V5.csv'
SEG=OUT/'GOVERNMENT_CONTRACTOR_SEGMENT_REPORT_V5.csv'
REP=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_REPAIR_V5.json'

TIERS=[(0,0,'NO_SALES'),(1,1_000_000,'LOW_SALES'),(1_000_001,3_000_000,'MEDIUM_SALES'),(3_000_001,10_000_000,'HIGH_SALES'),(10_000_001,float('inf'),'OVER_10M')]

def c(v):
    if v is None or (isinstance(v,float) and pd.isna(v)): return ''
    return str(v).strip()

def uei(v): return re.sub(r'[^A-Z0-9]','',c(v).upper())

def nname(v):
    s=c(v).upper()
    s=re.sub(r'\([^)]*\)',' ',s)
    s=re.sub(r'\bDBA\b.*$',' ',s)
    s=re.sub(r'[^A-Z0-9 ]+',' ',s)
    s=re.sub(r'\b(LLC|INC|CORP|CORPORATION|LTD|LP|LLP|CO|COMPANY)\b',' ',s)
    return re.sub(r'\s+',' ',s).strip()

def tier(v):
    try: v=max(float(v or 0),0)
    except: v=0
    for lo,hi,t in TIERS:
        if lo<=v<=hi: return t
    return 'OVER_10M'

if not V4.exists(): raise SystemExit(f'MISSING: {V4}')
if not BASE.exists(): raise SystemExit(f'MISSING: {BASE}')

m=pd.read_csv(V4,dtype=str,low_memory=False)
b=pd.read_csv(BASE,dtype=str,low_memory=False)

for df in (m,b):
    if 'uei' not in df.columns: df['uei']=''
    if 'legal_name' not in df.columns: df['legal_name']=''
    if 'vehicles' not in df.columns: df['vehicles']=''
    df['uei']=df['uei'].map(uei)
    df['_name']=df['legal_name'].map(nname)

# Build authoritative vehicle membership maps from the pre-revenue-repair master.
uei_to_vehicles={}
name_to_vehicles={}
name_amb=set()
for _,r in b.iterrows():
    vs=c(r.get('vehicles',''))
    if not vs: continue
    uu=c(r['uei']); nn=c(r['_name'])
    if uu:
        existing=uei_to_vehicles.get(uu,'')
        merged=sorted(set([x.strip() for x in (existing+';'+vs).split(';') if x.strip()]))
        uei_to_vehicles[uu]=';'.join(merged)
    if nn:
        if nn in name_to_vehicles and name_to_vehicles[nn]!=vs:
            # Merge, not reject: same company may legitimately have multiple memberships from separate rows.
            existing=name_to_vehicles[nn]
            merged=sorted(set([x.strip() for x in (existing+';'+vs).split(';') if x.strip()]))
            name_to_vehicles[nn]=';'.join(merged)
        else:
            name_to_vehicles[nn]=vs

before_pop=int(m['vehicles'].fillna('').astype(str).str.strip().ne('').sum())
restored_uei=0
restored_name=0
for i in m.index:
    cur=c(m.at[i,'vehicles'])
    uu=c(m.at[i,'uei']); nn=c(m.at[i,'_name'])
    recovered=''
    if uu and uu in uei_to_vehicles:
        recovered=uei_to_vehicles[uu]
        if not cur: restored_uei+=1
    elif nn and nn in name_to_vehicles:
        recovered=name_to_vehicles[nn]
        if not cur: restored_name+=1
    if recovered:
        vals=sorted(set([x.strip() for x in (cur+';'+recovered).split(';') if x.strip()]))
        m.at[i,'vehicles']=';'.join(vals)

after_pop=int(m['vehicles'].fillna('').astype(str).str.strip().ne('').sum())

# Recompute revenue tier and vehicle-specific segments.
if 'fy2025_revenue' not in m.columns: raise SystemExit('MISSING fy2025_revenue')
m['fy2025_revenue_num']=pd.to_numeric(m['fy2025_revenue'],errors='coerce').fillna(0.0)
m['revenue_tier_fy2025']=m['fy2025_revenue_num'].map(tier)

def build_segments(r):
    t=c(r['revenue_tier_fy2025']) or 'NO_SALES'
    vs=[x.strip() for x in c(r.get('vehicles','')).split(';') if x.strip()]
    return ';'.join(sorted(set(f'{v}_{t}' for v in vs)))

m['segments']=m.apply(build_segments,axis=1)

# Segment report + vehicle rollup.
counts={}
for _,r in m.iterrows():
    email=bool(c(r.get('email','')))
    for s in [x.strip() for x in c(r.get('segments','')).split(';') if x.strip()]:
        x=counts.setdefault(s,{'segment':s,'companies':0,'emails':0})
        x['companies']+=1
        if email: x['emails']+=1
segdf=pd.DataFrame(sorted(counts.values(),key=lambda x:(x['segment'])))
segdf.to_csv(SEG,index=False)

# Diagnostics by vehicle and tier.
vehicle_counts={}
for _,r in m.iterrows():
    t=c(r['revenue_tier_fy2025'])
    email=bool(c(r.get('email','')))
    for v in [x.strip() for x in c(r.get('vehicles','')).split(';') if x.strip()]:
        key=(v,t)
        x=vehicle_counts.setdefault(key,{'vehicle':v,'tier':t,'companies':0,'emails':0})
        x['companies']+=1
        if email:x['emails']+=1

m.drop(columns=['_name','fy2025_revenue_num'],inplace=True)
m.to_csv(OUT5,index=False)

report={
    'companies':len(m),
    'vehicle_rows_before_restore':before_pop,
    'vehicle_rows_restored_by_uei':restored_uei,
    'vehicle_rows_restored_by_name':restored_name,
    'vehicle_rows_after_restore':after_pop,
    'rows_with_segments':int(m['segments'].fillna('').astype(str).str.strip().ne('').sum()),
    'segment_count':len(counts),
    'output':str(OUT5),
    'segment_report':str(SEG)
}
REP.write_text(json.dumps(report,indent=2),encoding='utf-8')

print('=== GOVERNMENT CONTRACTOR TRUTH VEHICLE/SEGMENT REPAIR V5 ===')
for k,v in report.items(): print(f'{k}: {v}')
print('\nVEHICLE x FY2025 TIER')
for x in sorted(vehicle_counts.values(),key=lambda z:(z['vehicle'],['NO_SALES','LOW_SALES','MEDIUM_SALES','HIGH_SALES','OVER_10M'].index(z['tier']) if z['tier'] in ['NO_SALES','LOW_SALES','MEDIUM_SALES','HIGH_SALES','OVER_10M'] else 99)):
    print(f"{x['vehicle']:<16} {x['tier']:<13} companies={x['companies']:<7} emails={x['emails']}")
print('\nTOP SEGMENTS')
for x in sorted(counts.values(),key=lambda z:-z['companies'])[:50]:
    print(f"{x['segment']:<42} companies={x['companies']:<8} emails={x['emails']}")
