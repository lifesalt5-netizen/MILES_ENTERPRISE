'use strict';
const assert=require('assert');
const svc=require('../SERVICES/orion/FederalSourceReadinessAuditService');
assert.deepStrictEqual(svc.firstPresentEnv({SAM_API_KEY:'abc'},['SAM_API_KEY']),{present:true,envName:'SAM_API_KEY',length:3,value:'abc'});
assert.strictEqual(svc.mmddyyyy(new Date('2026-08-30T12:00:00Z')),'08/30/2026');
const html='<div>SAM_PUBLIC_UTF-8_MONTHLY_V2_20260705.ZIP</div><div>SAM_PUBLIC_UTF-8_MONTHLY_V2_20260802.ZIP</div>';
assert.deepStrictEqual(svc.latestUtf8EntityExtractFromHtml(html),{
  displayKey:'SAM_PUBLIC_UTF-8_MONTHLY_V2_20260802.ZIP',
  dateModified:null,
  size:null,
  discoveredFrom:'OFFICIAL_PUBLIC_DATA_SERVICES_PAGE'
});
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','SERVICES','orion','FederalSourceReadinessAuditService.js'),'utf8');
assert(src.includes('secretValuesLogged:false'));
assert(src.includes('authenticatedWebScraping:false'));
assert(src.includes('publicOfficialListingPageParsed'));
assert(src.includes('officialPublicListingFallbackAllowed:true'));
assert(src.includes('sourceMustBeHeadReachableBeforeReady:true'));
assert(src.includes('officialPublicDataServicesOnlyForBulk:true'));
assert(!src.includes('console.log(key.value)'));
console.log('FEDERAL_SOURCE_READINESS_AUDIT_TEST_PASS');
