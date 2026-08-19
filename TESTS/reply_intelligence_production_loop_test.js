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
  {id:"6",thread_id:"thread-d",timestamp_created:"2026-08-18T12:00:00Z",subject:"Re: offer",body:{text:"How much does this cost?"},from_address_email:"d@example.com",campaign_id:"c",lead_id:"l4"}
 ],next_starting_after:null};}};
 const svc=new Loop({rootDir:root,emailSource:source,log:()=>{}});
 const r=await svc.runOnce();
 assert.strictEqual(r.ok,true);
 assert.strictEqual(r.fetched.newRows,6);
 assert.strictEqual(r.latest.rawReceivedMessages,6);
 assert.strictEqual(r.latest.uniqueConversations,4);
 assert.strictEqual(r.latest.duplicateThreadMessages,2);
 assert.strictEqual(r.latest.rawReceived,4,"KPI denominator should be unique conversation states, not every thread message");
 assert.strictEqual(r.latest.qualifiedPositiveReplies,1,"old pricing message in same thread must not count after a later deferral");
 assert.strictEqual(r.latest.counts.NOT_NOW,1);
 assert.strictEqual(r.latest.counts.OOO,1);
 assert.strictEqual(r.latest.counts.UNSUBSCRIBE,1);
 assert.strictEqual(r.safety.repliesSent,0);
 assert.strictEqual(r.safety.campaignMutations,0);
 const q=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/qualified_reply_queue.json"),"utf8"));
 assert.strictEqual(q.length,1); assert.strictEqual(q[0].from,"d@example.com");
 const follow=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/followup_queue.json"),"utf8"));
 assert(follow.some(row=>row.from==="a@example.com"&&row.category==="NOT_NOW"));
 const s=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/global_suppression_master.json"),"utf8"));
 assert.strictEqual(s.entries[0].email,"c@example.com");
 const second=await svc.runOnce();
 assert.strictEqual(second.fetched.newRows,0);
 fs.rmSync(root,{recursive:true,force:true});
 console.log("PASS reply_intelligence_production_loop_test");
})().catch(e=>{console.error(e);process.exitCode=1;});
