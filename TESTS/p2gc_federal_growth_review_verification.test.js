'use strict';

const assert = require('assert');
const Service = require('../SERVICES/revenue/P2GCFederalGrowthReviewVerificationService');

(async()=>{
  const sent=[];
  const sender={ sendEmail: async payload => { sent.push(payload); return {ok:true,status:'IONOS_SMTP_SENT'}; } };
  let now=Date.parse('2026-09-03T20:00:00Z');
  const service=new Service({ sender, now:()=>now, ttlMs:600000, maxAttempts:5 });
  const review={
    reviewId:'P2GC-FGR-TEST-VERIFY',
    expiresAt:'2026-09-04T20:00:00Z',
    company:{name:'Example Federal LLC'},
    recipient:{email:'buyer@example.com',companyDomain:'example.com'},
    security:{revokedAt:null}
  };

  service.createCode=()=> '654321';
  const request=await service.requestCode(review,'buyer@example.com');
  assert.strictEqual(request.ok,true);
  assert.strictEqual(sent.length,1);
  assert.strictEqual(sent[0].from,'kevin@pathways2gc.com');
  assert.strictEqual(sent[0].to,'buyer@example.com');
  assert(sent[0].text.includes('654321'));

  const forwarded=await service.requestCode(review,'outsider@other.com');
  assert.strictEqual(forwarded.ok,false);
  assert.strictEqual(forwarded.reason,'OUTSIDE_ORGANIZATION_ACCESS_DENIED');

  const colleague=await service.requestCode(review,'colleague@example.com');
  assert.strictEqual(colleague.ok,false);
  assert.strictEqual(colleague.reason,'SAME_COMPANY_AUTHORIZATION_REQUIRED');

  const wrong=service.verifyCode(review,'buyer@example.com','000000');
  assert.strictEqual(wrong.ok,false);
  assert.strictEqual(wrong.reason,'VERIFICATION_CODE_INVALID');

  const verified=service.verifyCode(review,'buyer@example.com','654321');
  assert.strictEqual(verified.ok,true);
  assert.strictEqual(verified.authenticatedEmail,'buyer@example.com');

  const replay=service.verifyCode(review,'buyer@example.com','654321');
  assert.strictEqual(replay.ok,false);
  assert.strictEqual(replay.reason,'VERIFICATION_CODE_ALREADY_USED');

  console.log('P2GC_FEDERAL_GROWTH_REVIEW_VERIFICATION_GREEN');
})().catch(error=>{ console.error(error); process.exit(2); });
