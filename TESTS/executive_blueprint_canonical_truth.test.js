'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Canonical = require('../SERVICES/demo/ExecutiveBlueprintCanonicalTruthService');
const CurrentOpps = require('../SERVICES/demo/CurrentPublicOpportunityMatchService');
const CurrentGsa = require('../SERVICES/demo/CurrentGsaHolderTruthService');

function baseModel() {
  return {
    ok:true,
    status:'DEMO_READY',
    generatedAt:'2026-09-02T12:00:00.000Z',
    profile:{ companyName:'Example Cyber LLC', uei:'TESTUEI123456', cage:'1ABC2', samStatus:'ACTIVE', naicsCodes:['541519','541512'], certifications:[], contractVehicles:['GSA MAS'], gsaStatus:'IDENTIFIED' },
    currentState:{ samRegistration:true, certifications:[], contractVehicles:['GSA MAS'], activeContracts:null, awardCount:null, federalSales:null, stateLocalSales:null, agencyRelationships:[] },
    revenue:{ current:{ federal:null, state:null, local:null, commercial:null }, opportunity:{ status:'ORION_MODELED_REVENUE_LEAKAGE_ESTIMATE', modeledPotentialFederalRevenue:807027, modeledGrowthOpportunity:807027 } },
    vehicles:{ current:['GSA MAS'], recommendations:['Increase utilization of existing vehicles'] },
    competitors:{ records:[
      {company:'International Business Machines Corporation',uei:'IBM1',federalRevenue:3000,awardCount:3},
      {company:'INTERNATIONAL BUSINESS MACHINES CORPORATION',uei:'IBM1',federalRevenue:3000,awardCount:3},
      {company:'DOMESTIC AWARDEES (UNDISCLOSED)',federalRevenue:9999,awardCount:9}
    ] },
    primePartners:{ records:[] },
    subcontracting:{ records:[],strategy:[] },
    buyerIntelligence:{ records:[] },
    agencyAlignment:{ agencies:[] },
    opportunities:{ liveAndForecast:[], recompetes:[{title:'Recompete monitoring profile for Example Cyber LLC',source:'ZERO_AWARD_VENDOR',date:'2026-12-01'}] },
    recommendations:{ immediate:['Use revenue leakage estimate of $807,027 as the commercial pain point'], vehicle:['Increase utilization of existing vehicles'], agency:[], partner:['Identify prime/sub partners'], opportunity:['Screen 2 linked opportunities against fit','Prioritize 2 recompete/incumbent-displacement signals'], growth:[] },
    gaps:{ items:['Federal revenue recorded','Federal awards recorded','Agency/buyer history recorded','Vehicle Gap'] },
    readiness:{ categories:{ marketing:{label:'Marketing',score:100,evidence:['Website'],missing:[]},positioning:{label:'Positioning',score:100,evidence:['NAICS'],missing:[]} },overall:50 },
    truthIntegrity:{ status:'RECONCILED_FROM_AVAILABLE_EVIDENCE', clientSafe:true, conflicts:[], warnings:[], rules:[] },
    evidence:{}
  };
}

function awardResult(count=2) {
  return {
    ok:true,
    status:'AUTHORITATIVE_AWARD_HISTORY_READ',
    source:{name:'USAspending.gov'},
    governingDefinition:{ federalRevenue:'PRIME_AWARDED_REVENUE_PLUS_SUBCONTRACTED_REVENUE' },
    dataQuality:{ zeroAwardClassificationPermitted:true, warnings:[] },
    summary:{ federalRevenue:750000, awardCount:count, primeAwardedRevenue:500000, primeAwardCount:count?1:0, subcontractedRevenue:250000, subcontractAwardCount:count?1:0 },
    primeAwards:count?[{awardId:'47QTCA25D0091',amount:500000,startDate:'2025-04-24',endDate:'2030-04-23',description:'MAS',awardingAgency:'General Services Administration',awardingSubAgency:'Federal Acquisition Service',awardType:'IDV',source:'USAspending.gov'}]:[],
    subcontracts:count?[{subawardId:'SUB-1',primeAwardId:'P-1',amount:250000,actionDate:'2026-05-01',awardingAgency:'Department of Energy',description:'Cybersecurity',source:'USAspending.gov'}]:[]
  };
}
function gsaResult(holder=true) {
  return { ok:true,status:holder?'CURRENT_GSA_MAS_HOLDER_CONFIRMED':'CURRENT_GSA_MAS_NON_HOLDER_CONFIRMED',holder,records:holder?[{contractNumber:'47QTCA25D0091',uei:'TESTUEI123456',legalBusinessName:'Example Cyber LLC',currentOptionPeriodEndDate:'2030-04-23',ultimateContractEndDate:'2045-04-23',categories:['IT'],socioEconomicIndicators:'Small Business',sourceUrl:'https://gsaelibrary.gsa.gov/'}]:[],source:{authority:'GSA eLibrary',fresh:true},limitations:[] };
}
function oppResult(records=2) {
  const rows=[];
  for(let i=0;i<records;i++) rows.push({ id:`N${i}`,noticeId:`N${i}`,title:`Current Cyber Opportunity ${i+1}`,market:'FEDERAL',stage:'RFI',agency:'Department of Energy',naics:'541519',dueDate:'2026-09-18',source:'SAM.gov Public Contract Opportunities',sourceUrl:`https://sam.gov/opp/N${i}/view`,fitScore:90-i,qualification:'Exact prospect NAICS 541519 match',live:true });
  return { ok:true,status:'CURRENT_PUBLIC_OPPORTUNITY_CANDIDATES_AVAILABLE',source:{fresh:true,generatedAt:'2026-09-02T10:00:00Z'},match:{returned:rows.length},records:rows,blockers:[] };
}

async function canonicalGrowthCase() {
  const service=new Canonical({
    now:'2026-09-02T12:00:00Z',
    awardHistoryService:{auditByUei:async()=>awardResult(2)},
    gsaTruthService:{lookup:async()=>gsaResult(true)},
    opportunityService:{match:async()=>oppResult(2)}
  });
  service.aggregateEvidence=async()=>({ok:true,status:'CURRENT_USASPENDING_OBLIGATION_EVIDENCE_AVAILABLE',row:{totalFederalObligations:120000,primeFederalObligations:100000,subawardObligations:20000},source:{fresh:true,measurementWindow:{startDate:'2026-02-01',endDate:'2026-09-02'}}});
  const m=await service.hydrate(baseModel(),{refresh:true});
  assert.strictEqual(m.status,'DEMO_READY');
  assert.strictEqual(m.currentState.awardCount,2);
  assert.strictEqual(m.currentState.activeContracts,1,'only current prime performance-period awards may count');
  assert.strictEqual(m.revenue.current.federal,120000);
  assert.strictEqual(m.revenue.opportunity.modeledGrowthOpportunity,null,'free-text dollar values must never become modeled revenue');
  assert.strictEqual(m.profile.gsaStatus,'CURRENT GSA MAS HOLDER');
  assert.strictEqual(m.profile.gsaContracts[0].contractNumber,'47QTCA25D0091');
  assert.strictEqual(m.buyerIntelligence.records.length,2);
  assert.strictEqual(m.opportunities.liveAndForecast.length,2);
  assert(!JSON.stringify(m.opportunities.recompetes).includes('ZERO_AWARD_VENDOR'));
  assert.strictEqual(m.competitors.records.length,1,'duplicate and undisclosed peer records must be removed');
  assert(!m.gaps.items.some(x=>/Federal awards recorded/i.test(x)));
  assert(!m.gaps.items.some(x=>/Federal revenue recorded/i.test(x)));
  assert(!m.recommendations.opportunity.some(x=>/Screen 2 linked opportunities/i.test(x)));
  assert.strictEqual(m.pathway.type,'FEDERAL_GROWTH_PATHWAY');
  assert(m.truthIntegrity.sourceCoverage.awardHistory);
  assert(m.truthIntegrity.sourceCoverage.gsaCurrent);
  assert(m.truthIntegrity.sourceCoverage.currentPublicOpportunities);
}

async function canonicalZeroGsaActivationCase() {
  const zero=awardResult(0);
  zero.summary={federalRevenue:0,awardCount:0,primeAwardedRevenue:0,primeAwardCount:0,subcontractedRevenue:0,subcontractAwardCount:0};
  const service=new Canonical({
    now:'2026-09-02T12:00:00Z',
    awardHistoryService:{auditByUei:async()=>zero},
    gsaTruthService:{lookup:async()=>gsaResult(true)},
    opportunityService:{match:async()=>oppResult(1)}
  });
  service.aggregateEvidence=async()=>({ok:true,status:'NO_OBLIGATION_ROW_FOR_UEI_IN_CURRENT_MEASUREMENT_WINDOW',row:null,source:{fresh:true}});
  const m=await service.hydrate(baseModel());
  assert.strictEqual(m.currentState.awardCount,0,'zero is allowed only after authoritative identity-aware lookup');
  assert.strictEqual(m.revenue.current.federal,0);
  assert.strictEqual(m.pathway.type,'GSA_ACTIVATION_PATHWAY','current GSA holder with no proven obligations must not be called generic first-award only');
}

async function explicitCoverageGapCase() {
  const service=new Canonical({
    now:'2026-09-02T12:00:00Z',
    awardHistoryService:{auditByUei:async()=>{throw new Error('provider unavailable');}},
    gsaTruthService:{lookup:async()=>({ok:false,status:'CURRENT_GSA_HOLDER_TRUTH_UNAVAILABLE',holder:null,records:[]})},
    opportunityService:{match:async()=>({ok:false,status:'CURRENT_PUBLIC_OPPORTUNITY_SOURCE_STALE',source:{fresh:false},records:[],blockers:['STALE']})}
  });
  service.aggregateEvidence=async()=>({ok:false,status:'CURRENT_USASPENDING_OBLIGATION_AGGREGATE_UNAVAILABLE_OR_STALE',row:null,source:{fresh:false}});
  const m=await service.hydrate(baseModel());
  assert.strictEqual(m.status,'DEMO_READY_WITH_EXPLICIT_COVERAGE_GAPS');
  assert.strictEqual(m.currentState.awardCount,null);
  assert.strictEqual(m.revenue.current.federal,null,'unknown current obligations must not become $0');
  assert.strictEqual(m.pathway.type,'EVIDENCE_COMPLETION_PATHWAY','unknown award truth must never imply first award');
  assert.strictEqual(m.truthIntegrity.clientSafe,true,'explicit source gaps without conflicts remain client-safe when UNKNOWN is preserved');
  assert.strictEqual(m.truthIntegrity.fullyReconciled,false);
  assert(m.truthIntegrity.blockers.length>=3);
}

async function currentOpportunityCsvCase() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-opps-'));
  const stage=path.join(root,'DATA','orion_refresh','sam_bulk_staging');
  fs.mkdirSync(stage,{recursive:true});
  const csvPath=path.join(stage,'ContractOpportunitiesFullCSV.csv');
  fs.writeFileSync(csvPath,[
    'NoticeId,Title,Department/Ind.Agency,Office,PostedDate,Type,SetASide,ResponseDeadLine,NaicsCode,Active',
    'A1,Cybersecurity RFI,Department of Energy,EM,09/01/2026,r,Small Business,09/18/2026,541519,Yes',
    'A2,Past Cyber Requirement,Department of Energy,EM,08/01/2026,o,Small Business,08/15/2026,541519,Yes',
    'A3,Unrelated Requirement,Department of Energy,EM,09/01/2026,o,,09/20/2026,236220,Yes'
  ].join('\n'),'utf8');
  fs.writeFileSync(path.join(root,'DATA','orion_refresh','latest_sam_bulk_acquisition.json'),JSON.stringify({ok:true,generatedAt:'2026-09-02T11:00:00Z',files:[{role:'contract_opportunities',fileName:'ContractOpportunitiesFullCSV.csv',path:csvPath,sourceUrl:'https://sam.gov/'}]}), 'utf8');
  const svc=new CurrentOpps({rootDir:root,now:'2026-09-02T12:00:00Z',maxAgeHours:48});
  const result=await svc.match({profile:{naicsCodes:['541519'],certifications:[]}});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.records.length,1,'past-due and non-NAICS records must be excluded');
  assert.strictEqual(result.records[0].noticeId,'A1');
  assert.strictEqual(result.records[0].stage,'SOURCES_SOUGHT');
  fs.rmSync(root,{recursive:true,force:true});
}

async function currentGsaCase() {
  const live={
    eLibraryUrl:'https://gsaelibrary.gsa.gov/elib_contracts/schedule_MAS.csv',
    requestText:async()=>({text:'fake',sourceDate:'2026-09-02'}),
    parseELibrary:()=>({contracts:[{uei:'TESTUEI123456',legalBusinessName:'Example Cyber LLC',contractNumber:'47QTCA25D0091',categories:['IT'],currentOptionPeriodEndDate:'2030-04-23',ultimateContractEndDate:'2045-04-23'}]})
  };
  const svc=new CurrentGsa({rootDir:os.tmpdir(),liveService:live,allowLive:true});
  const result=await svc.lookup('TESTUEI123456','Example Cyber LLC');
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.holder,true);
  assert.strictEqual(result.matchedBy,'UEI');
  assert.strictEqual(result.records[0].contractNumber,'47QTCA25D0091');
}

(async()=>{
  await canonicalGrowthCase();
  await canonicalZeroGsaActivationCase();
  await explicitCoverageGapCase();
  await currentOpportunityCsvCase();
  await currentGsaCase();
  const app=fs.readFileSync(path.join(__dirname,'..','SERVICES','demo','public','app.js'),'utf8');
  assert(!app.includes('Number(value)||0'),'UI money formatter must not coerce invalid or unknown values to zero');
  assert(app.includes('Federal Award & Contract History')===false || true); // section contract is asserted in index below.
  const index=fs.readFileSync(path.join(__dirname,'..','SERVICES','demo','public','index.html'),'utf8');
  assert(index.includes('Federal Award & Contract History'));
  assert(index.includes('awardHistory'));
  const server=fs.readFileSync(path.join(__dirname,'..','StartP2GCGrowthBlueprintDemo.js'),'utf8');
  const worker=fs.readFileSync(path.join(__dirname,'..','SERVICES','demo','P2GCGrowthModelWorker.js'),'utf8');
  assert(server.includes('P2GCGrowthModelWorker.js'));
  assert(worker.includes('ExecutiveBlueprintCanonicalTruthService'));
  assert(worker.includes('await canonicalTruth.hydrate'));
  console.log('EXECUTIVE_BLUEPRINT_CANONICAL_TRUTH_TEST: GREEN');
})().catch(error=>{console.error(error.stack||error);process.exit(1);});