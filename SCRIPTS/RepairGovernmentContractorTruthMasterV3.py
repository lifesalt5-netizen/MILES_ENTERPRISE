from pathlib import Path
import re, json, os
import pandas as pd

ROOT=Path(r'D:\P2GC_Intelligence')
OUT=ROOT/'GOVERNMENT_CONTRACTOR_TRUTH'
MASTER=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V2.csv'
if not MASTER.exists(): MASTER=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER.csv'
OUT3=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_MASTER_V3.csv'
SEG=OUT/'GOVERNMENT_CONTRACTOR_SEGMENT_REPORT_V3.csv'
REP=OUT/'GOVERNMENT_CONTRACTOR_TRUTH_REPAIR_V3.json'
DISC=OUT/'AWARD_SOURCE_DISCOVERY_V3.csv'

TIERS=[(0,0,'NO_SALES'),(1,1_000_000,'LOW_SALES'),(1_000_001,3_000_000,'MEDIUM_SALES'),(3_000_001,10_000_000,'HIGH_SALES'),(10_000_001,float('inf'),'OVER_10M')]

def c(v):
    if v is None or (isinstance(v,float) and pd.isna(v)): return ''
    return str(v).strip()
def uei(v): return re.sub(r'[^A-Z0-9]','',c(v).upper())
def tier(v):
    try:v=max(float(v or 0),0)
    except:v=0
    for lo,hi,t in TIERS:
        if lo<=v<=hi:return t
    return 'OVER_10M'

def path_penalty(p):
    s=str(p).lower()
    pen=0
    if 'backup' in s: pen+=100
    if '_archive_old' in s or 'archive_2026_review' in s: pen+=20
    if 'orion_core' in s: pen-=10
    if 'usa_spending' in s: pen-=5
    return pen

def valid_award_file(p, year=None):
    try:
        h=pd.read_csv(p,nrows=3,dtype=str,low_memory=False)
        need={'recipient_uei','federal_action_obligation'}
        if not need.issubset(set(h.columns)): return False, None
        fycol='action_date_fiscal_year' if 'action_date_fiscal_year' in h.columns else None
        if year and fycol and len(h):
            vals=set(h[fycol].dropna().astype(str).str.strip())
            if vals and str(year) not in vals:
                # Do not reject solely from first rows if file may span years; filename remains evidence.
                pass
        return True, fycol
    except Exception:
        return False, None

def discover_year(year):
    patterns=[
        f'FY{year}_All_Contracts_Full_*.csv',
        f'FY{year}*Contracts*.csv',
        f'*Contracts*{year}*.csv',
    ]
    seen={}
    for pat in patterns:
        try:
            for p in ROOT.rglob(pat):
                if not p.is_file() or p in seen: continue
                ok,fycol=valid_award_file(p,year)
                if ok:
                    seen[p]={'path':p,'parent':p.parent,'size':p.stat().st_size,'fycol':fycol,'penalty':path_penalty(p)}
        except Exception:
            pass
    return list(seen.values())

def choose_source_set(year, candidates):
    if not candidates:return []
    groups={}
    for x in candidates:
        groups.setdefault(x['parent'],[]).append(x)
    ranked=[]
    for parent,items in groups.items():
        # Prefer non-backup/current trees, then complete multi-part sets, then size.
        penalty=min(i['penalty'] for i in items)
        total=sum(i['size'] for i in items)
        ranked.append((penalty,-len(items),-total,str(parent).lower(),parent,items))
    ranked.sort()
    return sorted([x['path'] for x in ranked[0][-1]], key=lambda p:p.name.lower())

# Use known current annual root for FY2022-24; discover FY2025-26 across the lake.
known=ROOT/'ORION_CORE'/'USA_Spending'/'ALL_YEARS_PRIME'
award_files={}
for yr in [2022,2023,2024]:
    fs=sorted(known.glob(f'FY{yr}_All_Contracts_Full_*.csv')) if known.exists() else []
    award_files[yr]=fs

discovery_rows=[]
for yr in [2025,2026]:
    cand=discover_year(yr)
    chosen=choose_source_set(yr,cand)
    award_files[yr]=chosen
    chosen_set={str(x) for x in chosen}
    for x in cand:
        discovery_rows.append({
            'year':yr,'path':str(x['path']),'parent':str(x['parent']),
            'size_mb':round(x['size']/1048576,2),'penalty':x['penalty'],
            'selected':'YES' if str(x['path']) in chosen_set else 'NO'
        })
pd.DataFrame(discovery_rows).to_csv(DISC,index=False)

print('=== AWARD SOURCE SELECTION V3 ===')
for yr,fs in award_files.items():
    print(f'FY{yr}: files={len(fs)}')
    for f in fs[:20]: print('  ',f)

m=pd.read_csv(MASTER,dtype=str,low_memory=False)
m['uei']=m['uei'].map(uei)
for col in ['fy2022_revenue','fy2023_revenue','fy2024_revenue','fy2025_revenue','fy2026_ytd_revenue']:
    m[col]=0.0

revenue={yr:{} for yr in award_files}
rows={yr:0 for yr in award_files}
read_errors=[]
for yr,files in award_files.items():
    for f in files:
        try:
            use=['recipient_uei','federal_action_obligation']
            # Include FY column where available so mixed-year files can be safely filtered.
            hdr=pd.read_csv(f,nrows=0)
            fycol='action_date_fiscal_year' if 'action_date_fiscal_year' in hdr.columns else None
            if fycol: use.append(fycol)
            for ch in pd.read_csv(f,dtype=str,usecols=use,chunksize=200000,low_memory=False):
                if fycol:
                    vals=ch[fycol].astype(str).str.strip()
                    # If this is a mixed-year file, retain only target FY; if all rows are target FY this is a no-op.
                    target=vals.eq(str(yr))
                    if target.any(): ch=ch[target]
                rows[yr]+=len(ch)
                ch['recipient_uei']=ch['recipient_uei'].map(uei)
                ch['amount']=pd.to_numeric(ch['federal_action_obligation'],errors='coerce').fillna(0.0)
                g=ch[ch['recipient_uei'].ne('')].groupby('recipient_uei')['amount'].sum()
                d=revenue[yr]
                for k,v in g.items(): d[k]=d.get(k,0.0)+float(v)
        except Exception as e:
            read_errors.append({'year':yr,'file':str(f),'error':str(e)})
            print('READ_ERROR',f,e)

for yr in [2022,2023,2024,2025]:
    m[f'fy{yr}_revenue']=m['uei'].map(revenue[yr]).fillna(0.0)
m['fy2026_ytd_revenue']=m['uei'].map(revenue[2026]).fillna(0.0)

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
    return ';'.join(sorted(set(f'{v}_{t}' for v in vs)))

m['revenue_tier_fy2025']=m['fy2025_revenue'].map(tier)
m['behavior']=m.apply(behavior,axis=1)
m['years_without_awards']=m.apply(years_no,axis=1)
m['segments']=m.apply(segments,axis=1)
m.to_csv(OUT3,index=False)

counts={}
for _,r in m.iterrows():
    for s in c(r['segments']).split(';'):
        if not s:continue
        x=counts.setdefault(s,{'segment':s,'companies':0,'emails':0})
        x['companies']+=1
        if c(r.get('email','')):x['emails']+=1
segdf=pd.DataFrame(sorted(counts.values(),key=lambda x:(-x['companies'],x['segment'])))
segdf.to_csv(SEG,index=False)

report={
    'companies':len(m),
    'blank_uei':int(m['uei'].eq('').sum()),
    'annual_files':{str(y):[str(f) for f in fs] for y,fs in award_files.items()},
    'annual_rows':rows,
    'unique_revenue_ueis':{str(y):len(revenue[y]) for y in revenue},
    'fy2025_positive_revenue_companies':int((m['fy2025_revenue']>0).sum()),
    'fy2026_ytd_positive_revenue_companies':int((m['fy2026_ytd_revenue']>0).sum()),
    'read_errors':read_errors,
    'output':str(OUT3),'segment_report':str(SEG),'discovery_report':str(DISC)
}
REP.write_text(json.dumps(report,indent=2),encoding='utf-8')

print('\n=== GOVERNMENT CONTRACTOR TRUTH REPAIR V3 ===')
for k,v in report.items():
    if k not in {'annual_files','read_errors'}: print(f'{k}: {v}')
if read_errors: print('READ_ERRORS:',len(read_errors))
print('\nTOP SEGMENTS')
for x in sorted(counts.values(),key=lambda x:-x['companies'])[:40]:
    print(f"{x['segment']:<42} companies={x['companies']:<8} emails={x['emails']}")
