"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const Loop=require("../SERVICES/revenue/ReplyIntelligenceProductionLoopService");
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"miles-reply-"));
 const source={async listEmails(){return {items:[
  {id:"1",subject:"Re: offer",body:{text:"How much does this cost?"},from_address_email:"a@example.com",campaign_id:"c",lead_id:"l"},
  {id:"2",subject:"Automatic reply",body:{text:"I am out of the office until August 22."},from_address_email:"b@example.com",campaign_id:"c",lead_id:"l2",is_auto_reply:1},
  {id:"3",subject:"Re: offer",body:{text:"Please unsubscribe me."},from_address_email:"c@example.com",campaign_id:"c",lead_id:"l3"}
 ],next_starting_after:null};}};
 const svc=new Loop({rootDir:root,emailSource:source,log:()=>{}});
 const r=await svc.runOnce();
 assert.strictEqual(r.ok,true);
 assert.strictEqual(r.latest.rawReceived,3);
 assert.strictEqual(r.latest.qualifiedPositiveReplies,1);
 assert.strictEqual(r.latest.counts.OOO,1);
 assert.strictEqual(r.latest.counts.UNSUBSCRIBE,1);
 assert.strictEqual(r.safety.repliesSent,0);
 assert.strictEqual(r.safety.campaignMutations,0);
 const q=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/qualified_reply_queue.json"),"utf8"));
 assert.strictEqual(q.length,1);
 const s=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/global_suppression_master.json"),"utf8"));
 assert.strictEqual(s.entries[0].email,"c@example.com");
 const second=await svc.runOnce();
 assert.strictEqual(second.fetched.newRows,0);
 fs.rmSync(root,{recursive:true,force:true});
 console.log("PASS reply_intelligence_production_loop_test");
})().catch(e=>{console.error(e);process.exitCode=1;});
