'use strict';

const assert=require('assert');
const Planner=require('../SERVICES/revenue/P2GCGoogleVidsSegmentPlannerService');

(function main(){
  const planner=new Planner({wordsPerMinute:135,maxSeconds:55});
  const paragraph=Array.from({length:18},(_,i)=>`Finding ${i+1} shows a company-specific federal growth issue that the advisor explains clearly, why it matters commercially, and how Pathways 2 Government Contracting can address the issue without giving away the full paid implementation plan.`).join(' ');
  const result=planner.plan({script:paragraph});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.provider,'GOOGLE_VIDS');
  assert(result.segmentCount>1);
  assert.strictEqual(result.allSegmentsWithinLimit,true);
  assert(result.segments.every(s=>s.estimatedSeconds<=56));
  assert(result.segments.every(s=>s.advisor==='P2GC Federal Growth Advisor'));
  assert.strictEqual(result.generationPolicy.paidActionAllowed,false);
  assert.throws(()=>planner.plan({script:''}),/PERSONALIZED_REVIEW_SCRIPT_REQUIRED/);
  console.log('P2GC_GOOGLE_VIDS_SEGMENT_PLANNER_GREEN');
})();
