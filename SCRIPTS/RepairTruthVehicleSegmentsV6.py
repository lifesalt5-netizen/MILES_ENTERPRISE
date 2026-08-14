from pathlib import Path
import re, json
import pandas as pd

ROOT=Path(r'D:\P2GC_Intelligence')
OUT=ROOT/'GOVERNMENT_CONTRACTOR_TRUTH'
BASE=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER.csv'
V4=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V4.csv'
OUT6=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V6.csv'
SEG=OUT/'GOVERNMENT_CONTRACTOR_SEGMENT_REPORT_V6.csv'
REP=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_REPAIR_V6.json'

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
    try:v=max(float(v or 0),0)
    except:v=0
    for lo,hi,t in TIERS:
        if lo<=v<=hi:return t
    return 'OVER_10M'

if not BASE.exists(): raise SystemExit(f'MISSING BASE TRUTH MASTER: {BASE}')
if not V4.exists(): raise SystemExit(f'MISSING V4 REVENUE MASTER: {V4}')

base=pd.read_csv(BASE,dtype=str,low_memory=False)
v4=pd.read_csv(V4,dtype=str,low_memory=False)

# The canonical column emitted by the original truth builder is vehicle_memberships, not vehicles.
veh_col='vehicle_memberships' if 'vehicle_memberships' in base.columns else ('vehicles' if 'vehicles' in base.columns else None)
if not veh_col: raise SystemExit(f'BASE MASTER HAS NO VEHICLE MEMBERSHIP COLUMN. COLUMNS={list(base.columns)}')

for df in [base,v4]:
    df['uei']=df['uei'].map(uei)
    df['_name']=df['legal_name'].map(nname) if 'legal_name' in df.columns else ''

# Build conservative maps: unique UEI and unique normalized-name only.
uei_to_vehicle={}
for uu,val in zip(base['uei'],base[veh_col]):
    vv=c(val)
    if uu and vv:
        old=uei_to_vehicle.get(uu,'')
        merged=sorted(set([x for x in (old+';'+vv).split(';') if x]))
        uei_to_vehicle[uu]=';'.join(merged)

name_sets={}
for nn,val in zip(base['_name'],base[veh_col]):
    vv=c(val)
    if nn and vv:
        name_sets.setdefault(nn,set()).add(vv)
name_to_vehicle={nn:next(iter(vals)) for nn,vals in name_sets.items() if len(vals)==1}

before=0
if 'vehicle_memberships' in v4.columns:
    before=int(v4['vehicle_memberships'].fillna('').astype(str).str.strip().ne('').sum())
else:
    v4['vehicle_memberships']=''

restored_uei=0; restored_name=0
for i in v4.index:
    cur=c(v4.at[i,'vehicle_memberships'])
    if cur: continue
    uu=v4.at[i,'uei']; nn=v4.at[i,'_name']
    vv=uei_to_vehicle.get(uu,'') if uu else ''
    if vv:
        v4.at[i,'vehicle_memberships']=vv; restored_uei+=1; continue
    vv=name_to_vehicle.get(nn,'') if nn else ''
    if vv:
        v4.at[i,'vehicle_memberships']=vv; restored_name+=1

# Also restore vehicle contracts and source lineage where safely available.
for col in ['vehicle_contracts','setaside_attributes']:
    if col not in v4.columns: v4[col]=''
    if col in base.columns:
        u_map={}
        for uu,val in zip(base['uei'],base[col]):
            if uu and c(val): u_map[uu]=c(val)
        for i in v4.index:
            if not c(v4.at[i,col]) and v4.at[i,'uei'] in u_map:
                v4.at[i,col]=u_map[v4.at[i,'uei']]

# Rebuild analytical segments from FY2025 completed-year total federal revenue.
def mksegments(r):
    t=tier(r.get('fy2025_revenue',0))
    vs=sorted(set(x.strip() for x in c(r.get('vehicle_memberships','')).split(';') if x.strip()))
    return ';'.join(f'{v}_{t}' for v in vs)

v4['current_revenue_tier']=v4['fy2025_revenue'].map(tier)
v4['segments']=v4.apply(mksegments,axis=1)
v4.drop(columns=['_name'],inplace=True)
v4.to_csv(OUT6,index=False)

counts={}
vehicle_tier={}
for _,r in v4.iterrows():
    email=bool(c(r.get('email','')))
    for s in [x for x in c(r.get('segments','')).split(';') if x]:
        x=counts.setdefault(s,{'segment':s,'companies':0,'emails':0})
        x['companies']+=1
        if email:x['emails']+=1
    for v in [x.strip() for x in c(r.get('vehicle_memberships','')).split(';') if x.strip()]:
        key=(v,c(r.get('current_revenue_tier','')))
        x=vehicle_tier.setdefault(key,{'vehicle':v,'tier':key[1],'companies':0,'emails':0})
        x['companies']+=1
        if email:x['emails']+=1

segdf=pd.DataFrame(sorted(counts.values(),key=lambda x:(x['segment'])))
segdf.to_csv(SEG,index=False)

report={
    'companies':len(v4),
    'base_vehicle_column':veh_col,
    'base_rows_with_vehicle_membership':int(base[veh_col].fillna('').astype(str).str.strip().ne('').sum()),
    'v4_rows_with_vehicle_membership_before_restore':before,
    'restored_by_uei':restored_uei,
    'restored_by_name':restored_name,
    'rows_with_vehicle_membership_after_restore':int(v4['vehicle_memberships'].fillna('').astype(str).str.strip().ne('').sum()),
    'rows_with_segments':int(v4['segments'].fillna('').astype(str).str.strip().ne('').sum()),
    'segment_count':len(counts),
    'output':str(OUT6),'segment_report':str(SEG)
}
REP.write_text(json.dumps(report,indent=2),encoding='utf-8')

print('=== GOVERNMENT CONTRACTOR TRUTH VEHICLE/SEGMENT REPAIR V6 ===')
for k,v in report.items(): print(f'{k}: {v}')
print('\nVEHICLE x FY2025 TIER')
order={'NO_SALES':0,'LOW_SALES':1,'MEDIUM_SALES':2,'HIGH_SALES':3,'OVER_10M':4}
for x in sorted(vehicle_tier.values(),key=lambda z:(z['vehicle'],order.get(z['tier'],99))):
    print(f"{x['vehicle']:<18} {x['tier']:<12} companies={x['companies']:<7} emails={x['emails']}")
print('\nTOP SEGMENTS')
for x in sorted(counts.values(),key=lambda x:-x['companies'])[:50]:
    print(f"{x['segment']:<42} companies={x['companies']:<8} emails={x['emails']}")
