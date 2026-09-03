'use strict';
const assert=require('assert');
const CurrentGsa=require('../SERVICES/demo/CurrentGsaHolderTruthService');

(async()=>{
  const csv='Vendor,Cont#,SAM UEI,Cat\nOTHER COMPANY,47QTCA20D0001,OTHERUEI123456,54151S\n';
  const live={
    eLibraryUrl:'https://gsaelibrary.gsa.gov/elib_contracts/schedule_MAS.csv',
    requestText:async()=>({text:csv,sourceDate:'2026-09-03'}),
    parseELibrary:()=>({contracts:[{legalBusinessName:'OTHER COMPANY',contractNumber:'47QTCA20D0001',uei:'OTHERUEI123456',categories:['54151S']}]})
  };
  const svc=new CurrentGsa({liveService:live,allowLive:true});
  const result=await svc.lookup('PFDWQAX9BHX6','KEBROS & ASSOC LLC');
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.holder,false);
  assert.strictEqual(result.masHolder,false);
  assert.strictEqual(result.sourceScope,'MAS_ONLY');
  assert(result.limitations.some(x=>/not evidence.*no other.*VA\/FSS/i.test(x)),'MAS non-holder must not imply no other federal vehicle');
  console.log('CURRENT_GSA_MAS_SCOPE_SEMANTICS_TEST: GREEN');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
