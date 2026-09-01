'use strict';
const DemoSamLiveOpportunityService = require('./DemoSamLiveOpportunityService');
function arr(v){return Array.isArray(v)?v:[];}
function norm(v){return String(v||'').trim().toUpperCase();}
class DemoLiveOpportunityOverlayService{
  constructor(options={}){this.live=options.live||new DemoSamLiveOpportunityService(options);}
  async apply(input={}){
    if(!input?.ok)return input;
    const model=JSON.parse(JSON.stringify(input));
    const result=await this.live.search(arr(model.profile?.naicsCodes));
    model.evidence=model.evidence||{};
    model.evidence.samLiveOpportunityFeed={status:result.status,asOf:result.asOf||null,sourceResults:result.sourceResults||[]};
    if(!result.ok){
      model.opportunities=model.opportunities||{};
      model.opportunities.liveFeedStatus='SAM_LIVE_UNAVAILABLE_USING_ORION_CURRENT_FEED';
      return model;
    }
    const existing=arr(model.opportunities?.liveAndForecast);
    const seen=new Set(); const merged=[];
    for(const row of [...result.records,...existing]){
      const key=norm(row.noticeId||`${row.solicitationNumber||''}|${row.title||''}|${row.dueDate||''}`);
      if(!key||seen.has(key))continue; seen.add(key); merged.push(row);
    }
    model.opportunities=model.opportunities||{};
    model.opportunities.liveAndForecast=merged;
    model.opportunities.live=merged.filter(x=>(x.kind||'LIVE')==='LIVE');
    model.opportunities.preSolicitation=merged.filter(x=>x.kind==='PRE_SOLICITATION');
    model.opportunities.forecast=merged.filter(x=>x.kind==='FORECAST');
    model.opportunities.status=merged.length?'CURRENT_QUALIFIED_OPPORTUNITIES_AVAILABLE':'NO_CURRENT_QUALIFIED_FITS';
    model.opportunities.liveFeedStatus='SAM_GOV_CURRENT_ACTIVE_FEED';
    model.opportunities.currentFeedAsOf=result.asOf;
    model.opportunities.sourceMethod='SAM.gov Opportunities API v2 active notices by client NAICS, merged with current ORION qualified signals';
    return model;
  }
}
module.exports=DemoLiveOpportunityOverlayService;
