'use strict';

const assert=require('assert');
const P2GCWarmPipelineContractService=require('../SERVICES/revenue/P2GCWarmPipelineContractService');
const {EXISTING_HEADERS,INTENT_HEADERS}=require('../SERVICES/revenue/P2GCWarmPipelineContractService');

const service=new P2GCWarmPipelineContractService({rootDir:process.cwd(),workbookPath:'C:/P2GC/MASTER.xlsx'});

const schema=service.schema();
assert.strictEqual(schema.sheetName,'Warm Prospect Master');
assert.strictEqual(schema.existingHeaders.length,41);
assert(INTENT_HEADERS.includes('Source URL'));
assert(INTENT_HEADERS.includes('Request / Pain Point'));
assert(INTENT_HEADERS.includes('Lead Temperature'));
assert(INTENT_HEADERS.includes('Research Completed'));
assert(INTENT_HEADERS.includes('Outreach Sent'));
assert(INTENT_HEADERS.includes('Closed / Won / Lost'));
assert(INTENT_HEADERS.includes('Revenue'));

const currentOnly=service.validateHeaders([...EXISTING_HEADERS]);
assert.strictEqual(currentOnly.ok,true);
assert.strictEqual(currentOnly.existingSchemaIntact,true);
assert.deepStrictEqual(currentOnly.missingExisting,[]);
assert.strictEqual(currentOnly.headersToAppend.length,INTENT_HEADERS.length);

const complete=service.validateHeaders([...EXISTING_HEADERS,...INTENT_HEADERS]);
assert.strictEqual(complete.ok,true);
assert.deepStrictEqual(complete.headersToAppend,[]);

const broken=service.validateHeaders(EXISTING_HEADERS.filter(x=>x!=='Company'));
assert.strictEqual(broken.ok,false);
assert(broken.missingExisting.includes('Company'));

const existingRows=[
  {'Company':'ACME Federal, LLC','Primary Contact':'Jane Owner','Email':'jane@acmefederal.example','Phone':'','Priority':'WARM-NEXT','Outreach Status':'Not Contacted'},
  {'Company':'Other Firm Inc','Primary Contact':'Alex Smith','Email':'alex@other.example','Phone':'','Priority':'WARM-NEXT','Outreach Status':'Not Contacted'}
];

const lead={
  company:'Acme Federal LLC',website:'https://www.acmefederal.example',contactName:'Jane Owner',title:'CEO',email:'jane@acmefederal.example',
  profileUrl:'https://www.linkedin.com/in/jane-owner',leadTemperature:'HOT',leadCategory:'GSA_HELP',currentNeed:'Needs help generating sales from an active GSA Schedule.',
  urgency:'CURRENT',fitRationale:'P2GC can diagnose GSA positioning and identify current buyer/opportunity paths.',researchCompleted:true,outreachPrepared:true,outreachSent:false,
  followUpDate:'2026-09-08',recommendedService:'GSA Activation Diagnostic',research:{federalPosition:'Active GSA holder with low/no observed sales.',agenciesBuyers:'Agency targets verified in research.',biggestGap:'No repeatable buyer/opportunity motion.',evidenceUrls:['https://sam.gov/example','https://www.gsaelibrary.gsa.gov/example']},
  signals:[{sourcePlatform:'LinkedIn',sourceUrl:'https://www.linkedin.com/posts/acme-gsa-help',originalPostDate:'2026-09-05',discoveredAt:'2026-09-05T13:00:00Z',signalType:'GSA_HELP',needSummary:'Needs help generating sales from an active GSA Schedule.',excerpt:'We have a GSA Schedule but are not getting sales and need help figuring out what to do next.',urgency:'CURRENT',fitRationale:'P2GC can diagnose GSA positioning and identify current buyer/opportunity paths.'}]
};

const mapped=service.mapLead(lead);
assert.strictEqual(mapped.Company,'Acme Federal LLC');
assert.strictEqual(mapped['Lead Source'],'LinkedIn');
assert.strictEqual(mapped['Source URL'],'https://www.linkedin.com/posts/acme-gsa-help');
assert.strictEqual(mapped['Original Post Date'],'2026-09-05');
assert.strictEqual(mapped['Lead Temperature'],'HOT');
assert.strictEqual(mapped.Priority,'HOT-INTENT');
assert.strictEqual(mapped['Research Completed'],'Y');
assert.strictEqual(mapped['Outreach Prepared'],'Y');
assert.strictEqual(mapped['Outreach Sent'],'N');
assert(mapped['Research Evidence URLs'].includes('sam.gov/example'));
assert.strictEqual(mapped['Recommended P2GC Offer'],'GSA Activation Diagnostic');

const plan=service.planUpsert(existingRows,lead);
assert.strictEqual(plan.ok,true);
assert.strictEqual(plan.action,'UPDATE');
assert.strictEqual(plan.matchIndex,0);
assert.strictEqual(plan.matchReason,'EMAIL');
assert.strictEqual(plan.row['Lead Temperature'],'HOT');
assert.strictEqual(plan.row['Source URL'],'https://www.linkedin.com/posts/acme-gsa-help');
assert.strictEqual(plan.row['Outreach Status'],'Prepared');
assert.strictEqual(plan.row['Company'],'Acme Federal LLC');

const domainMatch=service.planUpsert(existingRows,{...lead,email:'newperson@acmefederal.example',contactName:'Different Person'});
assert.strictEqual(domainMatch.action,'UPDATE');
assert.strictEqual(domainMatch.matchReason,'DOMAIN');

const newLead=service.planUpsert(existingRows,{...lead,company:'Brand New GovCon LLC',website:'https://brandnewgovcon.example',email:'owner@brandnewgovcon.example',contactName:'New Owner'});
assert.strictEqual(newLead.action,'APPEND');
assert.strictEqual(newLead.matchIndex,null);
assert.strictEqual(newLead.row.Company,'Brand New GovCon LLC');
for(const header of [...EXISTING_HEADERS,...INTENT_HEADERS]) assert(Object.prototype.hasOwnProperty.call(newLead.row,header),`mapped row missing ${header}`);

console.log('P2GC_INTENT_WARM_PIPELINE_CONTRACT_GREEN');
