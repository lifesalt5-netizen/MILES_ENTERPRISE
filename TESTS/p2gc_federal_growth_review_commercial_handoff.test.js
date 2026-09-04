'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');
const Handoff=require('../SERVICES/revenue/P2GCFederalGrowthReviewCommercialHandoffService');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-commercial-'));
try{
  const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'..','CONFIG','P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json'),'utf8'));
  const lifecycle=new Lifecycle({rootDir:root,contract,stateDir:path.join(root,'reviews')});
  const svc=new Handoff({rootDir:root,lifecycle,outDir:path.join(root,'handoffs')});
  const r=lifecycle.createReview({reviewId:'P2GC-COMMERCIAL-TEST',company:{name:'TEST CO'},recipient:{name:'Pat',email:'pat@example.com',companyDomain:'example.com'}});
  const draft=svc.buildDraft(r.reviewId,{packageName:'Federal Pathway Validation',scopeSummary:'Validate the recommended federal growth pathway.',price:2500,currency:'USD',proposalRef:'PROP-001',approvedByKevin:false});
  assert.equal(draft.status,'COMMERCIAL_HANDOFF_DRAFT_ONLY');
  assert.ok(draft.blockers.includes('KEVIN_APPROVAL_REQUIRED'));
  assert.ok(draft.blockers.includes('HTTPS_PAYMENT_HANDOFF_REQUIRED'));
  assert.notEqual(lifecycle.read(r.reviewId).stageState.PACKAGE_PROPOSAL_PAYMENT_HANDOFF.status,'COMPLETE');

  const spoofed=svc.buildDraft(r.reviewId,{packageName:'Federal Pathway Validation',scopeSummary:'Validate the recommended federal growth pathway.',price:2500,currency:'USD',proposalRef:'PROP-001',paymentUrl:'https://pay.example.com/p2gc-test',approvedByKevin:true,approvalNote:'Caller claims approval'});
  assert.equal(spoofed.status,'COMMERCIAL_HANDOFF_DRAFT_ONLY');
  assert.ok(spoofed.blockers.includes('KEVIN_APPROVAL_REQUIRED'));
  assert.equal(spoofed.draft.approvedByKevin,false);
  assert.equal(spoofed.draft.guards.callerSuppliedApprovalIgnored,true);

  lifecycle.approveRelease(r.reviewId,'KEVIN');
  const ready=svc.buildDraft(r.reviewId,{packageName:'Federal Pathway Validation',scopeSummary:'Validate the recommended federal growth pathway.',price:2500,currency:'USD',proposalRef:'PROP-001',paymentUrl:'https://pay.example.com/p2gc-test',approvedByKevin:false,approvalNote:'Approved for test'});
  assert.equal(ready.status,'PACKAGE_PROPOSAL_PAYMENT_HANDOFF_READY');
  assert.equal(ready.draft.approvedByKevin,true);
  assert.equal(ready.draft.approvalEvidence.source,'REVIEW_LIFECYCLE');
  assert.equal(ready.draft.guards.automaticCharge,false);
  assert.equal(ready.draft.guards.finalOfferRequiresKevin,true);
  assert.equal(lifecycle.read(r.reviewId).stageState.PACKAGE_PROPOSAL_PAYMENT_HANDOFF.status,'COMPLETE');
  assert.throws(()=>svc.markPayment(r.reviewId,{amount:2500}),/PAYMENT_AMOUNT_AND_REFERENCE_REQUIRED/);
  const payment=svc.markPayment(r.reviewId,{amount:2500,currency:'USD',paymentRef:'PAY-001'});
  assert.equal(payment.status,'PAYMENT_RECORDED');
  console.log('P2GC_FEDERAL_GROWTH_REVIEW_COMMERCIAL_HANDOFF_GREEN');
}finally{fs.rmSync(root,{recursive:true,force:true});}
