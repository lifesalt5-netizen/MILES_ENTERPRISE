'use strict';

function clean(v){return String(v==null?'':v).trim();}
function mmddyyyy(d){return `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`;}
function dateOnly(v){const d=new Date(v||0);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);}
function kind(type){const t=clean(type).toLowerCase();if(['r','p'].includes(t))return 'PRE_SOLICITATION';if(['o','k'].includes(t))return 'LIVE';if(t==='a')return 'AWARD_HISTORY';return 'LIVE';}

class DemoSamLiveOpportunityService{
  constructor(options={}){
    this.fetch=options.fetch||global.fetch;
    this.apiKey=clean(options.apiKey||process.env.SAM_API_KEY||process.env.SAM_GOV_API_KEY);
    this.base=options.base||'https://api.sam.gov/opportunities/v2/search';
    this.timeoutMs=Math.max(3000,Number(options.timeoutMs||15000));
  }
  async one(naics){
    if(!this.apiKey||typeof this.fetch!=='function')return {ok:false,status:'SAM_LIVE_FEED_KEY_OR_FETCH_UNAVAILABLE',records:[]};
    const to=new Date();const from=new Date(to.getTime()-90*86400000);
    const params=new URLSearchParams({api_key:this.apiKey,postedFrom:mmddyyyy(from),postedTo:mmddyyyy(to),limit:'100',offset:'0',ncode:String(naics),status:'active'});
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const res=await this.fetch(`${this.base}?${params.toString()}`,{signal:controller.signal,headers:{accept:'application/json'}});
      const text=await res.text();let data={};try{data=JSON.parse(text);}catch{}
      if(!res.ok)return {ok:false,status:`SAM_LIVE_HTTP_${res.status}`,records:[],error:data?.message||text.slice(0,300)};
      const rows=Array.isArray(data?.opportunitiesData)?data.opportunitiesData:[];
      const today=new Date().toISOString().slice(0,10);
      const records=rows.map(r=>({
        noticeId:r.noticeId||null,title:r.title||null,solicitationNumber:r.solicitationNumber||null,
        agency:r.fullParentPathName||r.department||r.subTier||null,office:r.office||null,postedDate:dateOnly(r.postedDate),
        dueDate:dateOnly(r.responseDeadLine||r.reponseDeadLine),naics:r.naicsCode||String(naics),setAside:r.typeOfSetAsideDescription||r.setAside||null,
        source:'SAM.gov Opportunities API v2',status:r.active==='Yes'||r.active===true?'ACTIVE':clean(r.active)||'ACTIVE',kind:kind(r.type),
        fitScore:100,updatedDate:dateOnly(r.postedDate),evidenceStatus:'CURRENT_AUTHORITATIVE_SOURCE'
      })).filter(x=>x.title&&x.kind!=='AWARD_HISTORY'&&(!x.dueDate||x.dueDate>=today));
      return {ok:true,status:'SAM_LIVE_FEED_CURRENT',asOf:new Date().toISOString(),naics:String(naics),totalRecords:Number(data?.totalRecords||records.length),records};
    }catch(e){return {ok:false,status:e?.name==='AbortError'?'SAM_LIVE_FEED_TIMEOUT':'SAM_LIVE_FEED_ERROR',records:[],error:e.message};}
    finally{clearTimeout(timer);}
  }
  async search(naicsCodes=[]){
    const codes=[...new Set((naicsCodes||[]).map(clean).filter(x=>/^\d{6}$/.test(x)))].slice(0,4);
    if(!codes.length)return {ok:false,status:'NO_VALID_NAICS_FOR_LIVE_FEED',records:[]};
    const results=await Promise.all(codes.map(n=>this.one(n)));
    const seen=new Set(),records=[];
    for(const result of results)for(const row of result.records||[]){const k=row.noticeId||`${row.solicitationNumber}|${row.title}`;if(!seen.has(k)){seen.add(k);records.push(row);}}
    records.sort((a,b)=>String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))||String(b.postedDate||'').localeCompare(String(a.postedDate||'')));
    return {ok:results.some(r=>r.ok),status:results.some(r=>r.ok)?'SAM_LIVE_FEED_CURRENT':'SAM_LIVE_FEED_UNAVAILABLE',asOf:new Date().toISOString(),records,sourceResults:results.map(r=>({status:r.status,naics:r.naics,totalRecords:r.totalRecords,error:r.error||null}))};
  }
}
module.exports=DemoSamLiveOpportunityService;
