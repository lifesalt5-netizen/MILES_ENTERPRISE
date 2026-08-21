from pathlib import Path
import pandas as pd
import re, json

ROOT=Path(r'D:\P2GC_Intelligence')
OUT=ROOT/'GOVERNMENT_CONTRACTOR_TRUTH'
MASTER=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V7.csv'
NORM=OUT/'NORMALIZED_VEHICLES'
OUT8=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V8.csv'
SEG=OUT/'GOVERNMENT_CONTRACTOR_SEGMENT_REPORT_V8.csv'
REP=OUT/'GOVERNMENT_CONTRACTOR_VEHICLE_MERGE_V8.json'

VEHICLES=['STARS_III','POLARIS','ALLIANT_2','ALLIANT_3','VETS_2']
TIERS=[(0,0,'NO_SALES'),(1,1_000_000,'LOW_SALES'),(1_000_001,3_000_000,'MEDIUM_SALES'),(3_000_001,10_000_000,'HIGH_SALES'),(10_000_001,float('inf'),'OVER_10M')]

def c(v):
    if v is None or (isinstance(v,float) and pd.isna(v)): return ''
    return str(v).strip()

def norm_uei(v): return re.sub(r'[^A-Z0-9]','',c(v).upper())
def norm_name(v):
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

def pick(cols, choices):
    lower={str(x).strip().lower():x for x in cols}
    for x in choices:
        if x.lower() in lower:return lower[x.lower()]
    for x in choices:
        for lc,real in lower.items():
            if x.lower() in lc:return real
    return None

def read_vehicle_file(vehicle):
    candidates=[
        NORM/f'{vehicle}.csv',
        NORM/f'{vehicle}_NORMALIZED.csv',
        NORM/f'{vehicle.lower()}.csv',
    ]
    # Also allow recursive exact-ish filename discovery under truth folder only.
    pats=[f'*{vehicle}*.csv',f'*{vehicle.replace("_"," ")}*.csv']
    seen=[]
    for p in candidates:
        if p.exists() and p.stat().st_size>0: seen.append(p)
    if not seen:
        for pat in pats:
            for p in OUT.rglob(pat):
                if p.is_file() and p.stat().st_size>0 and 'REPORT' not in p.name.upper() and 'MASTER' not in p.name.upper():
                    seen.append(p)
    # Prefer NORMALIZED_VEHICLES, then smallest path depth and latest mtime.
    if not seen:return None,None
    seen=sorted(set(seen),key=lambda p:(0 if 'NORMALIZED_VEHICLES' in str(p).upper() else 1,len(p.parts),-p.stat().st_mtime))
    for p in seen:
        try:
            df=pd.read_csv(p,dtype=str,low_memory=False)
            if len(df)>0:return p,df
        except Exception:
            pass
    return None,None

m=pd.read_csv(MASTER,dtype=str,low_memory=False)
for col in ['uei','legal_name','state','email','vehicle_memberships','vehicle_contracts','segments']:
    if col not in m.columns:m[col]=''
m['uei']=m['uei'].map(norm_uei)
m['_name']=m['legal_name'].map(norm_name)

uei_to_idx={}
for i,u in m['uei'].items():
    if u: uei_to_idx.setdefault(u,[]).append(i)
name_to_idx={}
for i,n in m['_name'].items():
    if n: name_to_idx.setdefault(n,[]).append(i)

stats=[]
for vehicle in VEHICLES:
    p,df=read_vehicle_file(vehicle)
    if df is None:
        stats.append({'vehicle':vehicle,'status':'MISSING','source':'','rows':0,'matched_uei':0,'matched_name':0,'appended':0})
        continue
    ucol=pick(df.columns,['uei','sam uei','unique entity identifier'])
    ncol=pick(df.columns,['legal_name','legal name','vendor','contractor name','organization name','business name','company name','company'])
    scol=pick(df.columns,['state'])
    ccol=pick(df.columns,['contract number','contract #','contract_number','contract'])
    ecol=pick(df.columns,['email','email address','group email','contact email'])
    matched_uei=matched_name=appended=0
    for _,r in df.iterrows():
        uu=norm_uei(r.get(ucol,'')) if ucol else ''
        nn=norm_name(r.get(ncol,'')) if ncol else ''
        st=c(r.get(scol,'')).upper() if scol else ''
        idx=None
        if uu and len(uei_to_idx.get(uu,[]))==1:
            idx=uei_to_idx[uu][0]; matched_uei+=1
        elif nn:
            cand=name_to_idx.get(nn,[])
            if len(cand)==1:
                idx=cand[0]; matched_name+=1
            elif len(cand)>1 and st and 'state' in m.columns:
                cand2=[i for i in cand if c(m.at[i,'state']).upper()==st]
                if len(cand2)==1:
                    idx=cand2[0]; matched_name+=1
        if idx is None:
            # Append a new identity only with enough evidence: UEI or legal name.
            if not uu and not nn: continue
            row={col:'' for col in m.columns if col!='_name'}
            row['uei']=uu
            row['legal_name']=c(r.get(ncol,'')) if ncol else ''
            row['state']=c(r.get(scol,'')) if scol else ''
            if ecol: row['email']=c(r.get(ecol,''))
            row['vehicle_memberships']=vehicle
            row['vehicle_contracts']=f'{vehicle}:{c(r.get(ccol,""))}' if ccol and c(r.get(ccol,'')) else ''
            row['segments']=f'{vehicle}_NO_SALES'
            row['current_revenue_tier']='NO_SALES' if 'current_revenue_tier' in row else ''
            # Revenue for appended records remains 0 until a future exact UEI/name revenue reconciliation.
            m=pd.concat([m,pd.DataFrame([row])],ignore_index=True)
            newi=len(m)-1
            m.at[newi,'_name']=nn
            if uu: uei_to_idx.setdefault(uu,[]).append(newi)
            if nn: name_to_idx.setdefault(nn,[]).append(newi)
            appended+=1
            continue
        existing=[x for x in c(m.at[idx,'vehicle_memberships']).split(';') if x]
        if vehicle not in existing: existing.append(vehicle)
        m.at[idx,'vehicle_memberships']=';'.join(sorted(set(existing)))
        if ccol and c(r.get(ccol,'')):
            vc=[x for x in c(m.at[idx,'vehicle_contracts']).split(';') if x]
            vc.append(f'{vehicle}:{c(r.get(ccol,""))}')
            m.at[idx,'vehicle_contracts']=';'.join(sorted(set(vc)))
        if ecol and not c(m.at[idx,'email']) and c(r.get(ecol,'')):
            m.at[idx,'email']=c(r.get(ecol,''))
    stats.append({'vehicle':vehicle,'status':'USED','source':str(p),'rows':len(df),'matched_uei':matched_uei,'matched_name':matched_name,'appended':appended})

# Rebuild segments from all memberships using FY2025 total federal revenue as current V7 behavior.
def segs(r):
    t=tier(r.get('fy2025_revenue',0))
    vs=[x.strip() for x in c(r.get('vehicle_memberships','')).split(';') if x.strip()]
    return ';'.join(sorted(set(f'{v}_{t}' for v in vs)))
m['segments']=m.apply(segs,axis=1)
if 'current_revenue_tier' in m.columns:m['current_revenue_tier']=m['fy2025_revenue'].map(tier)
m.drop(columns=['_name'],inplace=True,errors='ignore')
m.to_csv(OUT8,index=False)

counts={}
for _,r in m.iterrows():
    for s in c(r.get('segments','')).split(';'):
        if not s:continue
        x=counts.setdefault(s,{'segment':s,'companies':0,'emails':0})
        x['companies']+=1
        if c(r.get('email','')):x['emails']+=1
pd.DataFrame(sorted(counts.values(),key=lambda x:(-x['companies'],x['segment']))).to_csv(SEG,index=False)

report={'companies':len(m),'rows_with_vehicle_membership':int(m['vehicle_memberships'].astype(str).str.strip().ne('').sum()),'segment_count':len(counts),'vehicles':stats,'output':str(OUT8),'segment_report':str(SEG)}
REP.write_text(json.dumps(report,indent=2),encoding='utf-8')
print('=== GOVERNMENT CONTRACTOR FRESH VEHICLE MERGE V8 ===')
print('companies:',len(m))
print('rows_with_vehicle_membership:',report['rows_with_vehicle_membership'])
print('segment_count:',len(counts))
for x in stats:
    print(f"{x['vehicle']:<14} status={x['status']:<8} rows={x['rows']:<5} uei={x['matched_uei']:<4} name={x['matched_name']:<4} appended={x['appended']:<4} source={x['source']}")
print('output:',OUT8)
print('segment_report:',SEG)
print('\nVEHICLE COVERAGE')
for v in VEHICLES:
    mask=m['vehicle_memberships'].fillna('').astype(str).str.split(';').map(lambda xs:v in xs)
    print(f"{v:<14} companies={int(mask.sum()):<6} emails={int((mask & m['email'].fillna('').astype(str).str.strip().ne('')).sum())}")
print('\nTOP SEGMENTS')
for x in sorted(counts.values(),key=lambda x:-x['companies'])[:40]:
    print(f"{x['segment']:<42} companies={x['companies']:<8} emails={x['emails']}")
