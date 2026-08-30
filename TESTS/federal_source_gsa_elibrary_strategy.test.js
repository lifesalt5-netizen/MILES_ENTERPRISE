'use strict';
const assert=require('assert');
const Service=require('../SERVICES/orion/FederalSourceReadinessAuditService');

(async()=>{
  const svc=new Service({env:{GSA_API_KEY:'legacy-gsa-only'},now:'2026-08-30T19:00:00Z',timeoutMs:5000});
  const keys=Service.presentKeys(svc.env);
  assert.deepStrictEqual(keys,[], 'GSA_API_KEY must not be treated as a SAM credential');

  const svc2=new Service({env:{SAM_API_KEY:'sam-value',GSA_API_KEY:'gsa-value'},now:'2026-08-30T19:00:00Z',timeoutMs:5000});
  const names=Service.presentKeys(svc2.env).map(x=>x.envName);
  assert.deepStrictEqual(names,['SAM_API_KEY']);

  const fs=require('fs');
  const text=fs.readFileSync(require.resolve('../SERVICES/orion/FederalSourceReadinessAuditService'),'utf8');
  assert(text.includes("source:'GSA eLibrary'"));
  assert(text.includes("Schedule/SIN-driven public eLibrary retrieval"));
  assert(text.includes('doNotTreatGsaApiKeyAsSamCredential:true'));
  assert(text.includes('doNotUseSamApiForGsaMasAwardedSinTruth:true'));
  console.log('FEDERAL_SOURCE_GSA_ELIBRARY_STRATEGY_PASS');
})().catch(e=>{console.error(e);process.exit(1);});
