'use strict';
const fs=require('fs');
const path=require('path');

function text(v){return String(v??'').trim();}
function upper(v){return text(v).toUpperCase();}
function flat(v){if(v==null)return[];if(Array.isArray(v))return v.flatMap(flat);if(typeof v==='object')return Object.values(v).flatMap(flat);return[text(v)].filter(Boolean);}
function naicsOf(c={}){const values=flat([c.naics,c.naicsCodes,c.primaryNaics,c.primary_naics,c.allNaics,c.all_naics,c.assertions?.goodsAndServices?.naicsList]);const out=new Set();for(const v of values)for(const m of String(v).match(/\b\d{6}\b/g)||[])out.add(m);return[...out];}
function businessText(c={}){return flat([c.businessTypes,c.businessTypeList,c.entityRegistration?.businessTypes,c.coreData?.businessTypes,c.entityType,c.entityStructure,c.organizationType]).join(' ');}
function industryText(c={}){return flat([c.legalName,c.legalBusinessName,c.legal_name,c.company,c.industry,c.industryDescription,c.primaryNaicsDescription,c.naicsDescription,c.notes]).join(' ');}
function statusOf(c={}){return upper(c.registrationStatus??c.registration_status??c.entityStatus??c.entity_status??c.entityRegistration?.registrationStatus);}
function truthy(v){return v===true||v===1||/^(1|TRUE|YES|Y|ACTIVE)$/i.test(text(v));}

class SamLeadEligibilityService{
 constructor(options={}){this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||process.cwd());this.policy=options.policy||JSON.parse(fs.readFileSync(options.policyPath||path.join(this.rootDir,'CONFIG','GOVERNMENT_DATA','sam_lead_eligibility_policy.json'),'utf8'));}
 evaluate(candidate={}){
  const p=this.policy,reasons=[],reviewReasons=[];
  const status=statusOf(candidate);if(!['A','ACTIVE'].includes(status))reasons.push('SAM_REGISTRATION_NOT_ACTIVE');
  const bt=businessText(candidate);const it=industryText(candidate);const naics=naicsOf(candidate);
  const nonprofit=(p.nonprofitPatterns||[]).filter(x=>new RegExp(x,'i').test(`${bt} ${it}`));if(nonprofit.length)reasons.push('NONPROFIT_OR_NONCOMMERCIAL_ENTITY');
  const government=(p.governmentEntityPatterns||[]).filter(x=>new RegExp(x,'i').test(`${bt} ${it}`));if(government.length)reasons.push('GOVERNMENT_OR_INSTITUTIONAL_ENTITY');
  const forProfitExplicit=typeof candidate.forProfit==='boolean'?candidate.forProfit:/\bfor[ -]?profit organization\b/i.test(bt)?true:null;
  if(forProfitExplicit===false)reasons.push('NOT_FOR_PROFIT');else if(forProfitExplicit!==true&&!nonprofit.length&&!government.length)reviewReasons.push('FOR_PROFIT_NOT_CONFIRMED');
  const exclusionStatus=upper(candidate.exclusionStatus??candidate.exclusion_status??candidate.exclusionStatusFlag);if(truthy(candidate.excluded)||truthy(candidate.debarred)||truthy(candidate.suspended)||/EXCLUDED|DEBARRED|SUSPENDED/.test(exclusionStatus))reasons.push('EXCLUDED_SUSPENDED_OR_DEBARRED');
  const exact=new Set(p.hardExcludedNaics||[]);const prefixes=p.hardExcludedNaicsPrefixes||[];const blockedNaics=naics.filter(code=>exact.has(code)||prefixes.some(pre=>code.startsWith(pre)));const blockedPatterns=(p.hardExcludedPatterns||[]).filter(x=>new RegExp(x,'i').test(it));if(blockedNaics.length||blockedPatterns.length)reasons.push('EXCLUDED_INDUSTRY');
  const rejected=reasons.length>0;const reviewRequired=!rejected&&reviewReasons.length>0;const eligible=!rejected&&!reviewRequired;
  return{policyId:p.policyId,policyVersion:p.version,status:eligible?'ELIGIBLE':rejected?'REJECTED':'REVIEW_REQUIRED',eligible,retainInSamLeadUniverse:eligible,reasons,reviewReasons,evidence:{registrationStatus:status||null,businessTypeTextPresent:!!bt,naics,blockedNaics,blockedPatterns,nonprofitPatternsMatched:nonprofit,governmentPatternsMatched:government,exclusionStatus:exclusionStatus||null},nextStep:eligible?'SEGMENT_AND_ENRICH':'DO_NOT_ENTER_OPERATIONAL_LEAD_INVENTORY'};
 }
}
module.exports=SamLeadEligibilityService;module.exports.naicsOf=naicsOf;module.exports.statusOf=statusOf;
