"use strict";

const P2GCFocusedIntelligenceService = require("../SERVICES/demo/P2GCFocusedIntelligenceService");

const checks=[];
function check(name, ok, detail=null){checks.push({name,ok:Boolean(ok),detail});console.log(`[${ok?"PASS":"FAIL"}] ${name}${detail?` :: ${detail}`:""}`);}

const model={
  ok:true,
  generatedAt:"2026-08-16T20:00:00.000Z",
  profile:{companyName:"TEST PROSPECT",uei:"TESTUEI",cage:"TEST1",headquarters:"Tampa, FL",naicsCodes:["541512"],certifications:["SDVOSB"],samStatus:"ACTIVE",gsaStatus:"IDENTIFIED"},
  readiness:{overall:82,categories:{contractVehicles:{label:"Contract Vehicles",score:70,evidence:["GSA MAS"],missing:["Additional vehicle coverage"],checks:[]}}},
  gaps:{items:["Additional contract vehicle coverage","Buyer relationship evidence"]},
  vehicles:{current:["GSA MAS"],recommendations:["Validate aligned SIN expansion."],status:"CURRENT_VEHICLES_IDENTIFIED"},
  agencyAlignment:{agencies:[{agency:"TEST AGENCY",fitScore:88,basis:"Historical ORION buyer alignment"}]},
  opportunities:{
    liveAndForecast:[{title:"Test Opportunity",source:"ORION",status:"OPEN",dueDate:"2026-09-01",qualification:"ORION prospect-safe linked opportunity signal"}],
    recompetes:[{title:"Test Recompete",agency:"TEST AGENCY",date:"2027-01-01",value:1000000,signalType:"RECOMPETE",qualification:"Validated test signal"}]
  },
  recommendations:{immediate:["Review capture plan."],opportunity:["Qualify opportunity."],vehicle:["Validate aligned SIN expansion."],partner:["Validate teaming targets."]},
  pathway:{type:"GROWTH_PATHWAY",title:"Growth Pathway™",steps:["Qualify"]},
  evidence:{disclosure:"Test evidence only."},
  safety:{readOnly:true,writesEnabled:false,emailsSent:false,campaignsChanged:false}
};

const service=new P2GCFocusedIntelligenceService();
const opportunity=service.build("opportunities",model);
check("opportunity focused view builds",opportunity.ok===true&&opportunity.type==="opportunities");
check("opportunity records preserved",opportunity.records?.length===1&&opportunity.records[0].title==="Test Opportunity");
check("opportunity pathway preserved",opportunity.pathway?.type==="GROWTH_PATHWAY");
check("opportunity view stays read-only",opportunity.safety?.readOnly===true&&opportunity.safety?.writesEnabled===false);

const vehicle=service.build("vehicles",model);
check("vehicle focused view builds",vehicle.ok===true&&vehicle.type==="vehicles");
check("current vehicle evidence preserved",vehicle.currentVehicles?.includes("GSA MAS"));
check("vehicle gaps are scoped",vehicle.vehicleGaps?.length===1&&/vehicle/i.test(vehicle.vehicleGaps[0]));
check("vehicle readiness preserved",vehicle.readiness?.score===70);

const recompete=service.build("recompetes",model);
check("recompete focused view builds",recompete.ok===true&&recompete.type==="recompetes");
check("recompete signal preserved",recompete.records?.length===1&&recompete.records[0].title==="Test Recompete");
check("incumbent identity fails closed",recompete.currentCapability?.incumbentIdentity===false);
check("expiration alerts fail closed",recompete.currentCapability?.dedicatedExpirationAlerts===false);
check("recompete disclosure states limitation",/not claimed|not.*validated|current ORION/i.test(String(recompete.disclosure||"")));

const unsupported=service.build("unknown",model);
check("unsupported intelligence type rejected",unsupported.ok===false&&unsupported.status==="INTELLIGENCE_TYPE_UNSUPPORTED");

const report={ok:checks.every(x=>x.ok),checks};
console.log(`=== P2GC FOCUSED INTELLIGENCE ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);
if(!report.ok) console.log(JSON.stringify(report,null,2));
process.exitCode=report.ok?0:1;
