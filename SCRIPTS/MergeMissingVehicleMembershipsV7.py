from pathlib import Path
import re, json
import pandas as pd

ROOT=Path(r'D:\P2GC_Intelligence')
OUT=ROOT/'GOVERNMENT_CONTRACTOR_TRUTH'
BASE=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_CONTACTS_V1.csv'
if not BASE.exists(): BASE=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V6.csv'
OUTCSV=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V7.csv'
SEG=OUT/'GOVERNMENT_CONTRACTOR_SEGMENT_REPORT_V7.csv'
REP=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_VEHICLE_MERGE_V7.json'
NORM=OUT/'NORMALIZED_VEHICLES'

SOURCES={
 'STARS_III': NORM/'STARS_III.csv',
 'POLARIS': NORM/'POLARIS.csv',
 'ALLIANT_2': NORM/'ALLIANT_2.csv',
 'ALLIANT_3': NORM/'ALLIANT_3.csv',
 'VETS_2': NORM/'VETS_2.csv',
 'SEAPORT_NXG': ROOT/'ARCHIVE_2026_REVIEW'/'Good Files to use'/'SEAPORT_NXG_ORION_LAYER'/'SEAPORT_NXG_NORMALIZED.csv',
 'CIO_SP3': ROOT/'ARCHIVE_2026_REVIEW'/'Good Files to use'/'ORION_ADDITIONAL_ECOSYSTEMS'/'CIO_SP3_NORMALIZED.csv',
}
TIERS=[(0,0,'NO_SALES'),(1,1_000_000,'LOW_SALES'),(1_000_001,3_000_000,'MEDIUM_SALES'),(3_000_001,10_000_000,'HIGH_SALES'),(10_000_001,float('inf'),'OVER_10M')]

def c(v):
    if v is None or (isinstance(v,float) and pd.isna(v)): return ''
    return str(v).strip()
def uei(v): return re.sub(r'[^A-Z0-9]','',c(v).upper())
def nname(v):
    s=c(v).upper(); s=re.sub(r'\([^)]*\)',' ',s); s=re.sub(r'\bDBA\b.*$',' ',s)
    s=re.sub(r'[^A-Z0-9 ]+',' ',s); s=re.sub(r'\b(LLC|INC|CORP|CORPORATION|LTD|LP|LLP|CO|COMPANY)\b',' ',s)
    return re.sub(r'\s+',' ',s).strip()
def pick(cols, choices):
    m={str(x).strip().lower():x for x in cols}
    for q in choices:
        if q.lower() in m:return m[q.lower()]
    for q in choices:
        for k,v in m.items():
            if q.lower() in k:return v
    return None
def tier(v):
    try:v=max(float(v or 0),0)
    except:v=0
    for lo,hi,t in TIERS:
        if lo<=v<=hi:return t
    return 'OVER_10M'
def vehicles(v): return {x.strip() for x in c(v).split(';') if x.strip()}

def read_source(path):
    if not path.exists() or path.stat().st_size==0:return None
    try:return pd.read_csv(path,dtype=str,low_memory=False)
    except Exception:return None

m=pd.read_csv(BASE,dtype=str,low_memory=False)
if 'vehicle_memberships' not in m.columns:m['vehicle_memberships']=''
if 'vehicle_contracts' not in m.columns:m['vehicle_contracts']=''
for col in ['uei','legal_name','email','phone','website','state','fy2025_revenue']:
    if col not in m.columns:m[col]=''
m['_uei']=m['uei'].map(uei); m['_name']=m['legal_name'].map(nname)
uei_idx={}
for i,x in m['_uei'].items():
    if x and x not in uei_idx:uei_idx[x]=i
name_groups={}
for i,x in m['_name'].items():
    if x:name_groups.setdefault(x,[]).append(i)
unique_name_idx={k:v[0] for k,v in name_groups.items() if len(v)==1}

stats=[]
for vehicle,path in SOURCES.items():
    df=read_source(path)
    if df is None:
        stats.append({'vehicle':vehicle,'status':'MISSING_OR_READ_FAILED','source_rows':0,'matched_uei':0,'matched_name':0,'appended':0})
        continue
    ucol=pick(df.columns,['uei','sam uei','unique entity identifier'])
    ncol=pick(df.columns,['legal_name','legal name','organization name','contractor name','vendor','company','company name','business name'])
    ccol=pick(df.columns,['contract number','contract #','contract_number','contract(s)'])
    ecol=pick(df.columns,['email','group email','group email address','s3 group email address','vets 2 email'])
    pcol=pick(df.columns,['phone','phone number'])
    wcol=pick(df.columns,['website','website url','company website','url'])
    scol=pick(df.columns,['state'])
    mu=mn=ap=0
    for _,r in df.iterrows():
        uu=uei(r.get(ucol,'')) if ucol else ''
        nn=nname(r.get(ncol,'')) if ncol else ''
        idx=None
        if uu and uu in uei_idx: idx=uei_idx[uu]; mu+=1
        elif nn and nn in unique_name_idx: idx=unique_name_idx[nn]; mn+=1
        if idx is None:
            row={col:'' for col in m.columns if col not in {'_uei','_name'}}
            row['uei']=uu; row['legal_name']=c(r.get(ncol,'')) if ncol else ''
            row['vehicle_memberships']=vehicle; row['fy2025_revenue']='0'
            row['current_revenue_tier']='NO_SALES'; row['revenue_tier_fy2025']='NO_SALES'
            if ecol:row['email']=c(r.get(ecol,''))
            if pcol:row['phone']=c(r.get(pcol,''))
            if wcol:row['website']=c(r.get(wcol,''))
            if scol:row['state']=c(r.get(scol,''))
            if ccol and c(r.get(ccol,'')):row['vehicle_contracts']=f"{vehicle}:{c(r.get(ccol,''))}"
            new=pd.DataFrame([row])
            new['_uei']=new['uei'].map(uei); new['_name']=new['legal_name'].map(nname)
            idx=len(m); m=pd.concat([m,new],ignore_index=True)
            if uu:uei_idx[uu]=idx
            if nn: unique_name_idx.pop(nn,None)
            ap+=1
        else:
            vs=vehicles(m.at[idx,'vehicle_memberships']); vs.add(vehicle); m.at[idx,'vehicle_memberships']=';'.join(sorted(vs))
            if ccol and c(r.get(ccol,'')):
                cs=vehicles(m.at[idx,'vehicle_contracts']); cs.add(f"{vehicle}:{c(r.get(ccol,''))}"); m.at[idx,'vehicle_contracts']=';'.join(sorted(cs))
            if ecol and not c(m.at[idx,'email']) and c(r.get(ecol,'')):m.at[idx,'email']=c(r.get(ecol,''))
            if pcol and not c(m.at[idx,'phone']) and c(r.get(pcol,'')):m.at[idx,'phone']=c(r.get(pcol,''))
            if wcol and not c(m.at[idx,'website']) and c(r.get(wcol,'')):m.at[idx,'website']=c(r.get(wcol,''))
            if scol and not c(m.at[idx,'state']) and c(r.get(scol,'')):m.at[idx,'state']=c(r.get(scol,''))
    stats.append({'vehicle':vehicle,'status':'USED','source_rows':len(df),'matched_uei':mu,'matched_name':mn,'appended':ap})

# rebuild segments from FY2025 for every vehicle membership
for col in ['segments','current_revenue_tier','revenue_tier_fy2025']:
    if col not in m.columns:m[col]=''
def make_segments(r):
    t=tier(r.get('fy2025_revenue',0)); return ';'.join(sorted(f'{v}_{t}' for v in vehicles(r.get('vehicle_memberships',''))))
m['current_revenue_tier']=m['fy2025_revenue'].map(tier); m['revenue_tier_fy2025']=m['current_revenue_tier']; m['segments']=m.apply(make_segments,axis=1)
m.drop(columns=['_uei','_name'],errors='ignore').to_csv(OUTCSV,index=False)

counts={}
for _,r in m.iterrows():
    for s in vehicles(r.get('segments','')):
        x=counts.setdefault(s,{'segment':s,'companies':0,'emails':0}); x['companies']+=1
        if c(r.get('email','')):x['emails']+=1
pd.DataFrame(sorted(counts.values(),key=lambda x:(-x['companies'],x['segment']))).to_csv(SEG,index=False)

report={'companies':len(m),'sources':stats,'rows_with_vehicle_membership':int(m['vehicle_memberships'].fillna('').astype(str).str.strip().ne('').sum()),'segment_count':len(counts),'output':str(OUTCSV),'segment_report':str(SEG)}
REP.write_text(json.dumps(report,indent=2),encoding='utf-8')
print('=== GOVERNMENT CONTRACTOR VEHICLE MERGE V7 ===')
print('companies:',len(m)); print('rows_with_vehicle_membership:',report['rows_with_vehicle_membership']); print('segment_count:',len(counts))
for x in stats: print(f"{x['vehicle']:<14} status={x['status']:<22} rows={x['source_rows']:<7} uei={x['matched_uei']:<5} name={x['matched_name']:<5} appended={x['appended']}")
print('output:',OUTCSV); print('segment_report:',SEG)
print('\nVEHICLE COVERAGE')
for vehicle in SOURCES:
    sub=m[m['vehicle_memberships'].fillna('').astype(str).str.split(';').apply(lambda xs: vehicle in xs)]
    print(f"{vehicle:<14} companies={len(sub):<6} emails={sub['email'].fillna('').astype(str).str.strip().ne('').sum():<6}")
print('\nTOP SEGMENTS')
for x in sorted(counts.values(),key=lambda x:-x['companies'])[:50]: print(f"{x['segment']:<42} companies={x['companies']:<7} emails={x['emails']}")
