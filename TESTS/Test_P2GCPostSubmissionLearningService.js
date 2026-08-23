'use strict';

const assert=require('assert');
const os=require('os');
const path=require('path');
const fs=require('fs');
const P2GCPostSubmissionLearningService=require('../SERVICES/proposal/P2GCPostSubmissionLearningService');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-post-submission-'));
const svc=new P2GCPostSubmissionLearningService({outputDir:out});

let r=svc.run({solicitationId:'TEST-1',events:[{type:'DEBRIEF',sourceProof:'agency-email.eml',summary:'Controlled debrief evidence'}]});
assert.equal(r.status,'NOT_APPLICABLE');
assert.equal(r.events.length,0);
assert.equal(r.ignoredWithoutSubmissionProof,1);

r=svc.run({solicitationId:'TEST-1',submissionProof:'portal-receipt-123',events:[{type:'DEBRIEF',sourceProof:'agency-email.eml',summary:'Controlled debrief evidence'},{type:'LESSON_LEARNED',sourceProof:'internal-review.json',summary:'Controlled lesson'}]});
assert.equal(r.status,'POST_SUBMISSION_LEARNING_ACTIVE');
assert.equal(r.events.length,2);
assert.ok(r.events.every(e=>e.verified===true));
assert.ok(fs.existsSync(r.outputFile));
assert.throws(()=>svc.run({submissionProof:'receipt',events:[{type:'DEBRIEF'}]}),/PROOF_REQUIRED/);
console.log('P2GC_POST_SUBMISSION_LEARNING_TEST_PASS');
