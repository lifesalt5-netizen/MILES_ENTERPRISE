from pathlib import Path
import re, json
import pandas as pd

ROOT=Path(r'D:\P2GC_Intelligence')
OUT=ROOT/'GOVERNMENT_CONTRACTOR_TRUTH'
MASTER=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER.csv'
OUT2=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V2.csv'
SEG=OUT/'GOVERNMENT_CONTRACTOR_SEGMENT_REPORT_V2.csv'
REP=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_REPAIR_V2.json'

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

m=pd.read_csv(MASTER,dtype=str,low_memory=False)
for col in ['fy2022_revenue','fy2023_revenue','fy2024_revenue','fy2025_revenue','fy2026_ytd_revenue']:
    m[col]=0.0
m['_name']=m['legal_name'].map(nname)
m['uei']=m['uei'].map(uei)

# Build exact-name->UEI map from the existing award corpus plus annual award files.
name_to_uei={}
amb=set()
def add_name_map(df):
    if 'recipient_name' not in df.columns or 'recipient_uei' not in df.columns:return
    for nm,uu in zip(df['recipient_name'],df['recipient_uei']):
        nn=nname(nm); uu=uei(uu)
        if not nn or not uu:continue
        if nn in name_to_uei and name_to_uei[nn]!=uu: amb.add(nn)
        else:name_to_uei[nn]=uu

base=ROOT/'ORION_CORE'/'USA_Spending'/'OUTPUT'/'MASTER_PRIME.csv'
if base.exists():
    for ch in pd.read_csv(base,dtype=str,usecols=['recipient_uei','recipient_name'],chunksize=250000,low_memory=False):add_name_map(ch)
for x in amb:name_to_uei.pop(x,None)

blank=m['uei'].eq('')
filled=0
for i in m.index[blank]:
    uu=name_to_uei.get(m.at[i,'_name'],'')
    if uu:
        m.at[i,'uei']=uu; filled+=1

# Aggregate true annual files. Prefer ORION_CORE; use all part files for each FY.
annual_root=ROOT/'ORION_CORE'/'USA_Spending'/'ALL_YEARS_PRIME'
if not annual_root.exists(): annual_root=ROOT/'USA_Spending'/'ALL_YEARS_PRIME'
award_files={}
for yr in [2022,2023,2024,2025,2026]:
    fs=sorted(annual_root.glob(f'FY{yr}_All_Contracts_Full_*.csv'))
    award_files[yr]=fs

revenue={yr:{} for yr in award_files}
rows={yr:0 for yr in award_files}
for yr,files in award_files.items():
    for f in files:
        try:
            for ch in pd.read_csv(f,dtype=str,usecols=['recipient_uei','recipient_name','federal_action_obligation'],chunksize=200000,low_memory=False):
                rows[yr]+=len(ch)
                ch['recipient_uei']=ch['recipient_uei'].map(uei)
                ch['amount']=pd.to_numeric(ch['federal_action_obligation'],errors='coerce').fillna(0.0)
                g=ch[ch['recipient_uei'].ne('')].groupby('recipient_uei')['amount'].sum()
                d=revenue[yr]
                for k,v in g.items(): d[k]=d.get(k,0.0)+float(v)
        except Exception as e:
            print('READ_ERROR',f,e)

for yr in [2022,2023,2024,2025]:
    m[f'fy{yr}_revenue']=m['uei'].map(revenue[yr]).fillna(0.0)
m['fy2026_ytd_revenue']=m['uei'].map(revenue[2026]).fillna(0.0)

# Recompute behavior and segments using FY2025 completed year.
def behavior(r):
    vals=[float(r[f'fy{y}_revenue']) for y in [2022,2023,2024,2025]]; ytd=float(r['fy2026_ytd_revenue'])
    if not any(v>0 for v in vals) and ytd<=0:return 'NO_SALES_HISTORY'
    if ytd>0 and vals[-1]==0 and any(v>0 for v in vals[:-1]):return 'RETURNING'
    if vals[-1]>0:
        if vals[-2]==0 and all(v==0 for v in vals[:-2]):return 'NEW_ENTRANT'
        if vals[-2]>0 and vals[-1]>vals[-2]:return 'GROWING'
        if vals[-2]>0 and vals[-1]<vals[-2]:return 'DECLINING'
        return 'ACTIVE'
    if vals[-1]==0 and vals[-2]==0 and any(v>0 for v in vals[:-2]):return 'DORMANT'
    if vals[-1]==0 and any(v>0 for v in vals[:-1]):return 'LAPSED'
    return 'ACTIVE'

def years_no(r):
    if float(r['fy2026_ytd_revenue'])>0 or float(r['fy2025_revenue'])>0:return 0
    if float(r['fy2024_revenue'])>0:return 1
    if float(r['fy2023_revenue'])>0:return 2
    if float(r['fy2022_revenue'])>0:return 3
    return 4

def segments(r):
    t=tier(r['fy2025_revenue']); vs=[x.strip() for x in c(r.get('vehicles','')).split(';') if x.strip()]
    out=[]
    for v in vs: out.append(f'{v}_{t}')
    return ';'.join(sorted(set(out)))

m['revenue_tier_fy2025']=m['fy2025_revenue'].map(tier)
m['behavior']=m.apply(behavior,axis=1)
m['years_without_awards']=m.apply(years_no,axis=1)
m['segments']=m.apply(segments,axis=1)
m.drop(columns=['_name'],inplace=True)
m.to_csv(OUT2,index=False)

counts={}
for _,r in m.iterrows():
    for s in c(r['segments']).split(';'):
        if not s:continue
        x=counts.setdefault(s,{'segment':s,'companies':0,'emails':0})
        x['companies']+=1
        if c(r.get('email','')):x['emails']+=1
pd.DataFrame(sorted(counts.values(),key=lambda x:(-x['companies'],x['segment']))).to_csv(SEG,index=False)

report={'companies':len(m),'blank_uei_before':int(blank.sum()),'blank_uei_filled_by_exact_award_name':filled,'blank_uei_after':int(m['uei'].eq('').sum()),'annual_root':str(annual_root),'annual_files':{str(y):[str(f) for f in fs] for y,fs in award_files.items()},'annual_rows':rows,'fy2025_positive_revenue_companies':int((m['fy2025_revenue']>0).sum()),'fy2026_ytd_positive_revenue_companies':int((m['fy2026_ytd_revenue']>0).sum()),'output':str(OUT2),'segment_report':str(SEG)}
REP.write_text(json.dumps(report,indent=2),encoding='utf-8')
print('=== GOVERNMENT CONTRACTOR TRUTH REPAIR V2 ===')
for k,v in report.items():
    if k not in {'annual_files'}: print(f'{k}: {v}')
print('\nTOP SEGMENTS')
for x in sorted(counts.values(),key=lambda x:-x['companies'])[:30]:print(f"{x['segment']:<40} companies={x['companies']:<8} emails={x['emails']}")
