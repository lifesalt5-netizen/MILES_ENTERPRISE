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

  const lisNotice={
    id:"lis-1",
    thread_id:"thread-lis",
    timestamp_created:"2026-08-20T21:58:00-04:00",
    subject:"Automatic reply: Protect's GSA position",
    body:{text:[
      "Please note that the individual you attempted to contact is no longer with LIS Solutions, and this mailbox is no longer being monitored.",
      "For assistance, please contact the appropriate department below:",
      "Contracts: contract@lissol.com",
      "Finance/AP: lispayables@lissol.com",
      "Business Development: growth@lissol.com",
      "All other inquiries: HR@lissol.com",
      "Thank you, LIS Solutions"
    ].join("\n")},
    from_address_email:"ashurchin@lissol.com",
    campaign_id:"campaign-lis",
    lead_id:"lead-lis",
    is_auto_reply:1
  };
  const lis=detector.detect(lisNotice);
  assert(lis&&lis.detected===true,"LIS departed-contact notice must be detected");
  assert.strictEqual(lis.departedContactEmail,"ashurchin@lissol.com");
  assert.strictEqual(lis.replacementEmail,"growth@lissol.com","business development must outrank first-listed contracts/AP/HR addresses");
  assert.strictEqual(lis.replacementRole,"BUSINESS_DEVELOPMENT");
  assert(Array.isArray(lis.replacementCandidates)&&lis.replacementCandidates.length===4,"all departmental alternatives must be preserved");
  assert.strictEqual(lis.replacementCandidates[0].email,"growth@lissol.com");
  assert(lis.replacementCandidates.some(row=>row.email==="contract@lissol.com"&&row.role==="CONTRACTS"));
  assert(lis.replacementCandidates.some(row=>row.email==="lispayables@lissol.com"&&row.role==="FINANCE_AP"));
  assert(lis.replacementCandidates.some(row=>row.email==="hr@lissol.com"&&row.role==="HR"));

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

  const lisRoot=fs.mkdtempSync(path.join(os.tmpdir(),"miles-replacement-lis-"));
  const lisSource={async listEmails(){return {items:[lisNotice],next_starting_after:null};}};
  const lisSvc=new Loop({rootDir:lisRoot,emailSource:lisSource,log:()=>{}});
  const lisResult=await lisSvc.runOnce();
  assert.strictEqual(lisResult.ok,true);
  assert.strictEqual(lisResult.replacementContactsRecovered,1);
  const lisQueue=JSON.parse(fs.readFileSync(path.join(lisRoot,"DATA/runtime/revenue/replies/replacement_contact_queue.json"),"utf8"));
  assert.strictEqual(lisQueue.length,1);
  assert.strictEqual(lisQueue[0].replacementEmail,"growth@lissol.com");
  assert.strictEqual(lisQueue[0].replacementRole,"BUSINESS_DEVELOPMENT");
  assert.strictEqual(lisQueue[0].status,"VERIFICATION_REQUIRED");
  const lisSuppression=JSON.parse(fs.readFileSync(path.join(lisRoot,"DATA/runtime/revenue/replies/global_suppression_master.json"),"utf8"));
  assert(lisSuppression.entries.some(row=>row.email==="ashurchin@lissol.com"&&row.reason==="CONTACT_DEPARTED"));

  fs.rmSync(root,{recursive:true,force:true});
  fs.rmSync(lisRoot,{recursive:true,force:true});
  console.log("PASS replacement_contact_recovery_test");
})().catch(error=>{console.error(error);process.exitCode=1;});
