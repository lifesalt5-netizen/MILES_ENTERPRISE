'use strict';

const P2GCMarketingActivityService = require('../SERVICES/revenue/P2GCMarketingActivityService');

function main(){
  const service=new P2GCMarketingActivityService();
  const snapshot=service.refreshSnapshot();
  console.log(JSON.stringify({
    ok:true,
    service:'P2GC_MARKETING_ACTIVITY_COMMAND_CENTER',
    generatedAt:snapshot.generatedAt,
    publicSnapshot:'SERVICES/ceo_dashboard/public/marketing-activity.json',
    protectedPrimaryDomain:snapshot.protectedPrimaryDomain,
    diagnosticsPrepared:snapshot.diagnostics.prepared,
    calendarToday:snapshot.whatIsGoingOut.today.length,
    historyCount:snapshot.auditHistory.length
  },null,2));
  return snapshot;
}

if(require.main===module){
  try{ main(); }catch(error){ console.error(error.stack||error.message||String(error)); process.exitCode=2; }
}
module.exports={main};
