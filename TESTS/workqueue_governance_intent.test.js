'use strict';
const assert=require('assert');
const WorkQueueService=require('../SERVICES/WorkQueueService');
const service=Object.create(WorkQueueService.prototype);
service.normalizeBoolean=WorkQueueService.prototype.normalizeBoolean;
service.classifyGovernance=WorkQueueService.prototype.classifyGovernance;

function classify(input){return service.classifyGovernance(input);}

for(const input of [
  {title:'Analyze contract pipeline and report gaps',recommendedAction:'Analyze current federal contract performance and recommend next steps.'},
  {title:'Review pricing position',recommendedAction:'Review pricing data and prepare a remediation plan.'},
  {title:'Audit domain configuration',recommendedAction:'Audit current domain and DNS health without changes.'},
  {title:'Inspect legal document status',recommendedAction:'Review document status and report findings only.'}
]){
  const r=classify(input);
  assert.strictEqual(r.requiresKevin,false,JSON.stringify({input,r}));
  assert.strictEqual(r.executionType,'WORKFLOW');
}

for(const input of [
  {title:'Send proposal to client',recommendedAction:'Send the proposal now.'},
  {title:'Change DNS records',recommendedAction:'Update DNS to the new values.'},
  {title:'Purchase subscription',recommendedAction:'Purchase the subscription.'},
  {title:'Delete mailbox',recommendedAction:'Delete the mailbox.'},
  {title:'Submit final response',recommendedAction:'Submit the response to the agency.'}
]){
  const r=classify(input);
  assert.strictEqual(r.requiresKevin,true,JSON.stringify({input,r}));
  assert.strictEqual(r.executionType,'APPROVAL_REQUIRED');
}
console.log('WORKQUEUE_GOVERNANCE_INTENT_PASS');
