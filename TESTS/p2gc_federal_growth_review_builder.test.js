'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Builder=require('../SERVICES/revenue/P2GCFederalGrowthReviewBuilderService');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-review-builder-'));
  const contract=require('../CONFIG/P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json');
  const lifecycle=new Lifecycle({rootDir:path.resolve(__dirname,'..'),stateDir:path.join(temp,'reviews'),contract});
  const model={
    ok:true,
    profile:{companyName:'Example Federal LLC',uei:'EXAMPLEUEI123',cage:'1ABC2',samStatus:'ACTIVE'},
    truthIntegrity:{status:'CANONICAL_CURRENT_TRUTH_RECONCILED',checkedAt:'2026-09-03T20:00:00Z'},
    evidence:{
      currentSamRegistration:{authority:'SAM.gov',retrievedAt:'2026-09-03T19:50:00Z',confidence:'HIGH',verificationState:'CONFIRMED'},
      awardHistory:{authority:'USAspending',retrievedAt:'2026-09-03T19:51:00Z',confidence:'HIGH',verificationState:'CONFIRMED'},
      currentGsaHolderTruth:{authority:'GSA eLibrary',retrievedAt:'2026-09-03T19:52:00Z',confidence:'HIGH',verificationState:'CONFIRMED'},
      currentPublicOpportunities:{authority:'SAM.gov opportunities',retrievedAt:'2026-09-03T19:53:00Z',confidence:'HIGH',verificationState:'CONFIRMED'}
    },
    awardHistory:{totalAwards:12,totalPrimeAwardValue:2400000,records:Array(12).fill({})},
    vehicles:{count:1,records:[{vehicleFamily:'GSA MAS',contractNumber:'47QTCA00D0000'}]},
    opportunities:{qualification:{discovered:8,directFitSupported:2,nearFitGapClosable:1,teamingPathSupported:2,capabilityValidationRequired:3},liveAndForecast:Array(8).fill({})},
    recompetes:{total:2},
    primePartners:{records:[{company:'Prime A'},{company:'Prime B'},{company:'Prime C'}]},
    readiness:{overall:78}
  };
  const builder=new Builder({rootDir:path.resolve(__dirname,'..'),lifecycle,fetchAssessment:async()=>model});
  const result=await builder.createFromAssessment({term:'Example Federal LLC',recipientEmail:'buyer@example.com',recipientName:'Buyer',expirationHours:72});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.green,false);
  assert.strictEqual(result.company.name,'Example Federal LLC');
  assert(result.findingCount>=6);
  assert(result.runtime.estimatedMinutes>0);
  assert.strictEqual(result.nextRequiredStage,'PROFESSIONAL_AI_DEMO');
  const review=lifecycle.read(result.reviewId);
  for(const stage of ['PROSPECT_INTAKE','COMPANY_RESOLUTION','VERIFIED_INTELLIGENCE','ACCURATE_FINDINGS','PERSONALIZED_SCRIPT']) assert.strictEqual(review.stageState[stage].status,'COMPLETE',stage);
  assert.strictEqual(review.stageState.PROFESSIONAL_AI_DEMO.status,'PENDING');
  assert.strictEqual(review.release.approvedByKevin,false);
  assert.strictEqual(review.release.sentAt,null);
  assert.strictEqual(review.security.downloadable,false);
  assert(review.findings.every(f=>f.source&&f.freshness&&f.confidence&&f.verificationState));
  assert(!review.presentation.script.includes('full opportunity list'));
  console.log('P2GC_FEDERAL_GROWTH_REVIEW_BUILDER_GREEN');
})().catch(error=>{console.error(error);process.exit(2);});
