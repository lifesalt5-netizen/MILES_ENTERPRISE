"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const Replacement=require("../SERVICES/revenue/ReplacementContactRecoveryService");
const Loop=require("../SERVICES/revenue/ReplyIntelligenceProductionLoopService");

(async()=>{
  const detector=new Replacement();
  const notice={
    id:"r1",
    thread_id:"thread-replace",
    timestamp_created:"2026-08-20T13:18:00Z",
    subject:"Automatic reply: Build revenue from federal access",
    body:{text:"Hello, Thank you for your message. The prior contact is no longer with our company. Please direct all future inquiries to New Contact at new.contact@example.com."},
    from_address_email:"old.contact@example.com",
    campaign_id:"campaign-1",
    lead_id:"lead-old",
    is_auto_reply:1
  };
  const found=detector.detect(notice);
  assert(found&&found.detected===true);
  assert.strictEqual(found.departedContactEmail,"old.contact@example.com");
  assert.strictEqual(found.replacementEmail,"new.contact@example.com");
  assert.strictEqual(found.action,"REPLACE_CONTACT_AND_CONTINUE");

  const noRedirect=detector.detect({subject:"Automatic reply",body:{text:"I am out of office until Monday."},from_address_email:"person@example.com",is_auto_reply:1});
  assert.strictEqual(noRedirect,null,"ordinary OOO must not become contact replacement");

  const root=fs.mkdtempSync(path.join(os.tmpdir(),"miles-replacement-"));
  const source={async listEmails(){return {items:[notice],next_starting_after:null};}};
  const svc=new Loop({rootDir:root,emailSource:source,log:()=>{}});
  const result=await svc.runOnce();
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.replacementContactsRecovered,1);
  assert.strictEqual(result.executiveSurface.surfaced,0,"replacement auto notice must not be surfaced as positive reply");
  assert.strictEqual(result.followupsScheduled,0,"departed contact must not receive an OOO followup");
  const queue=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/replacement_contact_queue.json"),"utf8"));
  assert.strictEqual(queue.length,1);
  assert.strictEqual(queue[0].replacementEmail,"new.contact@example.com");
  assert.strictEqual(queue[0].status,"VERIFICATION_REQUIRED");
  assert.strictEqual(queue[0].nextAction,"VERIFY_SUPPRESSION_DEDUPE_AND_CREATE_REPLACEMENT_LEAD");
  const suppression=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/global_suppression_master.json"),"utf8"));
  assert(suppression.entries.some(row=>row.email==="old.contact@example.com"&&row.reason==="CONTACT_DEPARTED"));
  fs.rmSync(root,{recursive:true,force:true});
  console.log("PASS replacement_contact_recovery_test");
})().catch(error=>{console.error(error);process.exitCode=1;});
