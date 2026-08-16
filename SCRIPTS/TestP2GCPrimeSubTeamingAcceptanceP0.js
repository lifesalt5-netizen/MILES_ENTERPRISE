"use strict";

const P2GCPrimeSubTeamingService = require("../SERVICES/teaming/P2GCPrimeSubTeamingService");

const checks=[];
function check(name, ok, detail=null){checks.push({name,ok:Boolean(ok),detail});console.log(`[${ok?"PASS":"FAIL"}] ${name}${detail?` :: ${detail}`:""}`);}

const fixture={
  ok:true,
  profile:{companyName:"Fixture Small Business",uei:"FIXTUREUEI001",cage:"1TEST",naicsCodes:["541512"],certifications:["SDVOSB"],contractVehicles:["GSA MAS"]},
  readiness:{overall:82},
  pathway:{type:"GROWTH_PATHWAY"},
  competitors:{status:"ORION_MARKET_PEER_MODEL"},
  primePartners:{
    status:"ORION_MARKET_PEER_MODEL",
    disclosure:"Modeled candidate set; validate before external reliance.",
    strategy:["Target primes with agency and vehicle alignment."],
    records:[
      {company:"Prime One",uei:"PRIMEONE001",federalRevenue:25000000,awardCount:12,vehicle:"GSA MAS",agencies:["Department A"],basis:"Shares primary NAICS 541512; ORION market-peer model",confidence:"MODELED_CANDIDATE"},
      {company:"Prime Two",uei:"PRIMETWO002",federalRevenue:18000000,awardCount:8,vehicle:"CIO-SP4",agencies:["Department B","Department A"],basis:"Shares primary NAICS 541512; ORION market-peer model",confidence:"MODELED_CANDIDATE"}
    ]
  },
  subcontracting:{status:"ORION_TEAMING_SIGNALS_AVAILABLE",records:[{title:"Teaming signal",source:"ORION",status:"OPEN",dueDate:"2026-10-01"}]},
  agencyAlignment:{status:"ORION_HISTORICAL_ALIGNMENT_MODEL",agencies:[{agency:"Department A",fitScore:95,historicalSpend:5000000,awardCount:6,basis:"Historical ORION buyer alignment"}]},
  evidence:{disclosure:"Fixture evidence disclosure."}
};

const fakeBlueprint={build(term){return term?fixture:{ok:false,status:"TERM_REQUIRED"};}};
const service=new P2GCPrimeSubTeamingService({blueprintService:fakeBlueprint});
const result=service.build("Fixture Small Business");

check("Sub2Prime service returns usable product",result.ok===true&&/Sub2Prime/i.test(result.product),result.status);
check("prospect identity preserved",result.prospect?.uei==="FIXTUREUEI001",result.prospect?.companyName);
check("prime candidates ranked",result.primeCandidates?.length===2&&result.primeCandidates[0]?.rank===1,`candidates=${result.primeCandidates?.length||0}`);
check("prime matching evidence exposed",result.primeCandidates.every(x=>Array.isArray(x.whyMatched)&&x.whyMatched.length>0));
check("vehicle overlap is explainable",result.primeCandidates[0].whyMatched.some(x=>/share identified vehicle GSA MAS/i.test(x)));
check("subcontracting signals preserved",result.subcontractingOpportunities?.records?.length===1,result.subcontractingOpportunities?.status);
check("agency targeting present",result.targetAgencies?.[0]?.agency==="Department A",`agencies=${result.targetAgencies?.length||0}`);
check("partner actions generated",result.recommendedActions?.length>=3,`actions=${result.recommendedActions?.length||0}`);
check("contacts fail closed instead of invented",result.primeCandidates.every(x=>x.contact?.status==="UNAVAILABLE_IN_CURRENT_ORION_RECORD"&&x.contact.email===null&&x.contact.phone===null));
check("teaming system is read-only",result.safety?.readOnly===true&&result.safety?.writesEnabled===false&&result.safety?.outreachSent===false&&result.safety?.contactsInvented===false);
check("modeled evidence disclosure retained",/validate/i.test(result.evidence?.disclosure||""),result.evidence?.disclosure);

const limited=service.fromBlueprint({...fixture,primePartners:{status:"UNAVAILABLE",records:[],strategy:[]},subcontracting:{status:"NO_CURRENT_TEAMING_SIGNAL_IDENTIFIED",records:[]},agencyAlignment:{status:"UNAVAILABLE",agencies:[]}});
check("limited evidence is labeled, not fabricated",limited.status==="TEAMING_INTELLIGENCE_LIMITED"&&limited.primeCandidates.length===0&&limited.targetAgencies.length===0,limited.status);

const ok=checks.every(x=>x.ok);
console.log(`=== P2GC PRIME/SUB TEAMING ACCEPTANCE ${ok?"PASS":"FAIL"} ===`);
process.exitCode=ok?0:1;
