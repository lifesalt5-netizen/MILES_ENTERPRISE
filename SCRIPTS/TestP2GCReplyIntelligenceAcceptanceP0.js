"use strict";

const ReplyIntelligenceEngine = require("../SERVICES/ReplyIntelligenceEngine");

const checks=[];
function add(name,ok,detail=null){checks.push({name,ok:Boolean(ok),detail});console.log(`[${ok?"PASS":"FAIL"}] ${name}${detail?` :: ${detail}`:""}`);}

const calls={crm:[],booking:[],instantly:[],email:[]};
const engine=new ReplyIntelligenceEngine({connectors:{
  crm:{update:async payload=>{calls.crm.push(payload);return{ok:true};}},
  booking:{request:async payload=>{calls.booking.push(payload);return{ok:true,bookingUrl:"https://example.test/book"};}},
  instantly:{run:async payload=>{calls.instantly.push(payload);return{ok:true};}},
  email:{send:async payload=>{calls.email.push(payload);return{ok:true};}}
}});

(async()=>{
  const notInterested=engine.classify({text:"Thanks, but we're not interested. Please remove me."});
  add("negated interest cannot become hot lead",notInterested.type==="notInterested",`${notInterested.type}/${notInterested.bucket}`);

  const unsubscribe=engine.classify({text:"unsubscribe me from future emails"});
  add("unsubscribe routes to negative/DNC",unsubscribe.type==="notInterested"&&unsubscribe.bucket==="NEGATIVE");

  const ooo=engine.classify({subject:"Automatic Reply: Out of Office",text:"I am currently away and will return on Monday."});
  add("out-of-office is separate from spam",ooo.type==="outOfOffice"&&ooo.bucket==="OOO",`${ooo.type}/${ooo.bucket}`);

  const bounce=engine.classify({subject:"Delivery Status Notification",text:"550 5.1.1 address not found"});
  add("delivery failure routes technical",bounce.type==="technical"&&bounce.bucket==="TECHNICAL",bounce.reason);

  const meeting=engine.classify({text:"Yes, let's talk. Can we schedule a call next week?"});
  add("explicit meeting intent wins positive classification",meeting.type==="meeting"&&meeting.bucket==="POSITIVE",meeting.reason);

  const interested=engine.classify({text:"This sounds good. Please send me more information."});
  add("positive interest classified",interested.type==="interested"&&interested.bucket==="POSITIVE");

  const nurture=engine.classify({text:"Not now, but please follow up next quarter."});
  add("not-now reply goes to nurture",nurture.type==="notNow"&&nurture.bucket==="NURTURE");

  const routing=await engine.processReplies([
    {text:"Please schedule a meeting.",lead:{email:"meeting@example.test"}},
    {text:"Interested - tell me more.",lead:{email:"positive@example.test"}},
    {text:"Maybe later, follow up next month.",lead:{email:"later@example.test"}},
    {text:"Not interested. Stop emailing me.",lead:{email:"no@example.test"}},
    {subject:"Automatic Reply: Out of Office",text:"Out of office until Monday",lead:{email:"ooo@example.test"}},
    {text:"550 5.1.1 mailbox unavailable",lead:{email:"bounce@example.test"}},
    {text:"This is spam",lead:{email:"spam@example.test"}},
    {text:"Can you clarify your service?",lead:{email:"review@example.test"}}
  ]);

  add("meeting KPI counted",routing.summary.meeting===1&&routing.summary.qualifiedMeetingsRequested===1,String(routing.summary.qualifiedMeetingsRequested));
  add("all reply classes conserved",routing.processed.length===8&&Object.values(routing.summary).slice(0,8).reduce((a,b)=>a+b,0)===8,`processed=${routing.processed.length}`);
  add("meeting invokes booking flow",calls.booking.length===1&&routing.processed[0].route.stage==="MEETING_REQUESTED");
  add("positive interest becomes HOT_LEAD",routing.processed[1].route.stage==="HOT_LEAD");
  add("nurture invokes Instantly route",calls.instantly.length===1&&routing.processed[2].route.stage==="NURTURE");
  add("negative reply becomes DO_NOT_CONTACT",routing.processed[3].route.stage==="DO_NOT_CONTACT");
  add("OOO remains eligible for later handling",routing.processed[4].route.stage==="OUT_OF_OFFICE");
  add("technical reply requires review",routing.processed[5].route.stage==="TECHNICAL_REVIEW");
  add("spam bucket stays separate",routing.processed[6].route.stage==="SPAM");
  add("uncertain human reply goes to review queue",routing.processed[7].route.stage==="REVIEW_QUEUE");
  add("CRM receives one stage update per reply",calls.crm.length===8,`updates=${calls.crm.length}`);
  add("automatic positive acknowledgement only for interested reply",calls.email.length===1&&calls.email[0].to==="positive@example.test",`emails=${calls.email.length}`);

  const failClosed=new ReplyIntelligenceEngine();
  const safe=await failClosed.processReplies([{text:"Let's schedule a meeting",lead:{email:"safe@example.test"}}]);
  add("missing external connectors fail closed without fake execution",safe.processed[0].route.executedActions===0&&safe.processed[0].route.actions.every(x=>x.executed===false),`executed=${safe.processed[0].route.executedActions}`);

  const ok=checks.every(x=>x.ok);
  console.log(`=== P2GC REPLY INTELLIGENCE ACCEPTANCE ${ok?"PASS":"FAIL"} ===`);
  process.exitCode=ok?0:1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
