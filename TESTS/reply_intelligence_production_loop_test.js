"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const Loop=require("../SERVICES/revenue/ReplyIntelligenceProductionLoopService");

(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"miles-reply-"));
 const source={async listEmails(){return {items:[
  {id:"1",thread_id:"thread-a",timestamp_created:"2026-08-07T14:39:35Z",subject:"Pursuit of Federal Contracts",body:{text:"How much does this cost?"},from_address_email:"a@example.com",campaign_id:"c",lead_id:"l"},
  {id:"2",thread_id:"thread-a",timestamp_created:"2026-08-07T14:55:16Z",subject:"RE: P2GC Consulting",body:{text:"Thx Kevin, too rich for a startup, maybe a year from now."},from_address_email:"a@example.com",campaign_id:"c",lead_id:"l"},
  {id:"3",thread_id:"thread-a",timestamp_created:"2026-08-08T14:50:38Z",subject:"Product Offering",body:{text:"Kevin, our product offering provides a video solution."},from_address_email:"a@example.com",campaign_id:"c",lead_id:"l"},
  {id:"4",thread_id:"thread-b",timestamp_created:"2026-08-18T10:00:00Z",subject:"Automatic reply",body:{text:"I am out of the office until August 22."},from_address_email:"b@example.com",campaign_id:"c",lead_id:"l2",is_auto_reply:1},
  {id:"5",thread_id:"thread-c",timestamp_created:"2026-08-18T11:00:00Z",subject:"Re: offer",body:{text:"Please unsubscribe me."},from_address_email:"c@example.com",campaign_id:"c",lead_id:"l3"},
  {id:"6",thread_id:"thread-d",timestamp_created:"2026-08-18T12:00:00Z",subject:"Re: offer",body:{text:"How much does this cost?"},from_address_email:"d@example.com",campaign_id:"c",lead_id:"l4"},
  {id:"7",thread_id:"thread-e",timestamp_created:"2026-08-18T13:00:00Z",subject:"Automatic reply",body:{text:"Thanks for reaching out. This is an automated response."},from_address_email:"e@example.com",campaign_id:"c",lead_id:"l5",is_auto_reply:1},
  {id:"8",thread_id:"thread-f",timestamp_created:"2026-08-18T14:00:00Z",subject:"Delivery failure",body:{text:"Address not found."},from_address_email:"mailer-daemon@example.com",campaign_id:"c",lead_id:"l6"},
  {id:"9",thread_id:"thread-g",timestamp_created:"2026-08-18T15:00:00Z",subject:"Re: offer",body:{text:"No thank you, not interested."},from_address_email:"g@example.com",campaign_id:"c",lead_id:"l7"},
  {id:"10",thread_id:"thread-h",timestamp_created:"2026-08-18T16:00:00Z",subject:"Re: offer",body:{text:"Can you explain which agencies you focus on?"},from_address_email:"h@example.com",campaign_id:"c",lead_id:"l8"}
 ],next_starting_after:null};}};
 const svc=new Loop({rootDir:root,emailSource:source,log:()=>{}});
 const r=await svc.runOnce();
 assert.strictEqual(r.ok,true);
 assert.strictEqual(r.fetched.newRows,10);
 assert.strictEqual(r.latest.rawReceivedMessages,10);
 assert.strictEqual(r.latest.uniqueConversations,8);
 assert.strictEqual(r.latest.duplicateThreadMessages,2);
 assert.strictEqual(r.latest.rawReceived,8,"KPI denominator should be unique conversation states, not every thread message");
 assert.strictEqual(r.latest.qualifiedPositiveReplies,1,"only the pricing question should surface as qualified positive");
 assert.strictEqual(r.latest.counts.NOT_NOW,1);
 assert.strictEqual(r.latest.counts.OOO,1);
 assert.strictEqual(r.latest.counts.UNSUBSCRIBE,1);
 assert.strictEqual(r.latest.counts.AUTO_REPLY,1);
 assert.strictEqual(r.latest.counts.BOUNCE_TECHNICAL,1);
 assert.strictEqual(r.latest.counts.NEGATIVE,1);
 assert.strictEqual(r.latest.counts.NEUTRAL_QUESTION,1);
 assert.strictEqual(r.safety.repliesSent,0);
 assert.strictEqual(r.safety.campaignMutations,0);
 assert.strictEqual(r.safety.nonQualifiedExecutiveInboxAllowed,false);
 assert.strictEqual(r.executiveSurface.policy,"QUALIFIED_POSITIVE_ONLY");
 assert.strictEqual(r.executiveSurface.rawForwardingAllowed,false);
 assert.strictEqual(r.executiveSurface.surfaced,1);
 assert.strictEqual(r.executiveSurface.withheld,7);
 const q=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/qualified_reply_queue.json"),"utf8"));
 assert.strictEqual(q.length,1); assert.strictEqual(q[0].from,"d@example.com");
 const execQ=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/executive_reply_surface_queue.json"),"utf8"));
 assert.strictEqual(execQ.length,1,"only qualified replies may enter executive surface queue");
 assert.strictEqual(execQ[0].from,"d@example.com");
 assert.strictEqual(execQ[0].surfaceToExecutiveInbox,true);
 const follow=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/followup_queue.json"),"utf8"));
 assert(follow.some(row=>row.from==="a@example.com"&&row.category==="NOT_NOW"));
 assert(follow.some(row=>row.from==="b@example.com"&&row.category==="OOO"));
 const review=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/manual_review_queue.json"),"utf8"));
 assert(review.some(row=>row.from==="h@example.com"&&row.category==="NEUTRAL_QUESTION"));
 const s=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/global_suppression_master.json"),"utf8"));
 const suppressedEmails=new Set(s.entries.map(row=>row.email));
 assert(suppressedEmails.has("c@example.com"));
 assert(suppressedEmails.has("mailer-daemon@example.com"));
 assert(suppressedEmails.has("g@example.com"));
 const second=await svc.runOnce();
 assert.strictEqual(second.fetched.newRows,0);
 fs.rmSync(root,{recursive:true,force:true});
 console.log("PASS reply_intelligence_production_loop_test");
})().catch(e=>{console.error(e);process.exitCode=1;});
