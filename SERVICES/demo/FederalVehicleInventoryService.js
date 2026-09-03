'use strict';

function clean(v){ return String(v == null ? '' : v).trim(); }
function norm(v){ return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function uniq(values){ return [...new Set((Array.isArray(values)?values:[]).map(clean).filter(Boolean))]; }
function decodeHtml(text){ return clean(text).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'); }
function cellText(html){ return decodeHtml(clean(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')); }
function tableRows(html){
  const rows=[];
  const rowRe=/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while((rowMatch=rowRe.exec(String(html||'')))){
    const cells=[];
    const cellRe=/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while((cellMatch=cellRe.exec(rowMatch[1]))) cells.push(cellText(cellMatch[1]));
    if(cells.length) rows.push(cells);
  }
  return rows;
}
function looksContractNumber(value){
  const v=clean(value).toUpperCase();
  if(!v || v.length<8 || v.length>30 || !/[0-9]/.test(v)) return false;
  return /^(?:GS-|47[A-Z0-9]|36F797|V797D|HHS|W91|N00|FA|SP|NNG|NNX|NNH|NNA|DE-|DOC|DTFA|HQ|DHS|HSHQ|AG|EP|VA|75[A-Z0-9])[A-Z0-9-]+$/.test(v) || /^[A-Z0-9]{8,20}$/.test(v);
}
function classifyVehicle(source,title,contractNumber){
  const text=norm(`${source} ${title}`);
  const contract=clean(contractNumber).toUpperCase();
  if(/\bMAS\b|MULTIPLE AWARD SCHEDULE/.test(text)) return 'GSA_MAS';
  if(/\b621 I\b|PROFESSIONAL AND ALLIED HEALTHCARE STAFFING/.test(text)) return 'VA_FSS_621I';
  if(/VA FSS|FEDERAL SUPPLY SCHEDULE/.test(text) || /^36F797|^V797D/.test(contract)) return 'VA_FSS';
  if(/OASIS\+|OASIS PLUS/.test(text)) return 'OASIS_PLUS';
  if(/STARS III|8 A STREAMLINED TECHNOLOGY ACQUISITION RESOURCE/.test(text)) return 'STARS_III';
  if(/SEWP/.test(text)) return 'SEWP';
  if(/GWAC/.test(text)) return 'GWAC';
  if(/BPA/.test(text)) return 'BPA';
  if(/IDIQ|INDEFINITE DELIVERY/.test(text)) return 'IDIQ';
  return 'FEDERAL_CONTRACT_VEHICLE_OTHER';
}
function parseContractorInfo(html){
  const text=cellText(html);
  const uei=(text.match(/SAM UEI\s*:?\s*([A-Z0-9]{12})/i)||[])[1]||null;
  const contractor=(text.match(/Contractor\s*:?\s*([^\n]+?)(?:Address|Call|Email|Web Address|SAM UEI)/i)||[])[1]||null;
  const rows=tableRows(html);
  const records=[];
  for(const cells of rows){
    const contractIndex=cells.findIndex(looksContractNumber);
    if(contractIndex<0) continue;
    const contractNumber=clean(cells[contractIndex]);
    const source=contractIndex>=2?clean(cells[contractIndex-2]):(contractIndex>=1?clean(cells[0]):null);
    const title=contractIndex>=1?clean(cells[contractIndex-1]):null;
    const after=cells.slice(contractIndex+1);
    const dates=after.filter(v=>/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/i.test(clean(v)) || /^\d{4}-\d{2}-\d{2}$/.test(clean(v)));
    const categories=after.filter(v=>/^[A-Z0-9][A-Z0-9+()./-]{2,20}$/i.test(clean(v)) && !looksContractNumber(v) && !/^\d{4}-\d{2}-\d{2}$/.test(clean(v)));
    records.push({
      source:source||null,
      title:title||null,
      contractNumber,
      vehicleType:classifyVehicle(source,title,contractNumber),
      currentOptionPeriodEndDate:dates[0]||null,
      ultimateContractEndDate:dates[1]||null,
      categories:uniq(categories),
      authority:'GSA eLibrary',
      sourceStatus:'LIVE_GSA_ELIBRARY_CONTRACTOR_INFO'
    });
  }
  const map=new Map();
  for(const record of records){ const key=record.contractNumber.toUpperCase(); if(!map.has(key)) map.set(key,record); }
  return { contractor:clean(contractor)||null, uei:uei?uei.toUpperCase():null, records:[...map.values()] };
}
function seedContractNumbers(model){
  const seeds=[];
  for(const row of Array.isArray(model?.profile?.gsaContracts)?model.profile.gsaContracts:[]) if(row?.contractNumber) seeds.push(row.contractNumber);
  for(const row of Array.isArray(model?.awardHistory?.primeAwards)?model.awardHistory.primeAwards:[]){
    const id=clean(row?.awardId);
    const type=norm(row?.awardType);
    if(id && (looksContractNumber(id) || /IDV|INDEFINITE|SCHEDULE|GWAC|BPA/.test(type))) seeds.push(id);
  }
  return uniq(seeds).slice(0,10);
}
function contractorInfoUrl(contractNumber,companyName){
  return `https://www.gsaelibrary.gsa.gov/ElibMain/contractorInfo.do?contractNumber=${encodeURIComponent(clean(contractNumber))}&contractorName=${encodeURIComponent(clean(companyName))}&executeQuery=YES`;
}

class FederalVehicleInventoryService{
  constructor(options={}){
    this.fetch=options.fetch||globalThis.fetch;
    this.timeoutMs=Math.max(1000,Number(options.timeoutMs||30000));
  }
  async request(url){
    if(typeof this.fetch!=='function') throw new Error('fetch unavailable');
    const response=await this.fetch(url,{headers:{'User-Agent':'MILES-Government-Data-Staging/1.0',Accept:'text/html'},signal:AbortSignal.timeout(this.timeoutMs)});
    const text=await response.text();
    if(!response.ok) throw new Error(`GSA eLibrary contractor-info HTTP ${response.status}`);
    return text;
  }
  async discover(model={}){
    const companyName=clean(model?.profile?.companyName||model?.profile?.legalBusinessName||model?.companyName);
    const targetUei=clean(model?.profile?.uei).toUpperCase();
    const seeds=seedContractNumbers(model);
    const failures=[];
    for(const seed of seeds){
      try{
        const url=contractorInfoUrl(seed,companyName);
        const parsed=parseContractorInfo(await this.request(url));
        if(targetUei && parsed.uei && parsed.uei!==targetUei) { failures.push(`UEI_MISMATCH:${seed}`); continue; }
        if(parsed.records.length) return { ok:true,status:'FEDERAL_VEHICLE_INVENTORY_CONFIRMED_FROM_GSA_ELIBRARY_CONTRACTOR_INFO',records:parsed.records,matchedSeed:seed,source:{authority:'GSA eLibrary',url},limitations:failures,safety:{readOnly:true} };
      }catch(error){ failures.push(`${seed}:${String(error?.message||error)}`); }
    }
    return { ok:false,status:seeds.length?'FEDERAL_VEHICLE_INVENTORY_NOT_RESOLVED_FROM_SEEDED_CONTRACTS':'NO_AUTHORITATIVE_CONTRACT_SEED_AVAILABLE_FOR_BROAD_VEHICLE_LOOKUP',records:[],seeds,limitations:failures,safety:{readOnly:true} };
  }
}

module.exports=FederalVehicleInventoryService;
module.exports.helpers={tableRows,parseContractorInfo,looksContractNumber,classifyVehicle,seedContractNumbers,contractorInfoUrl};
