"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const Backfill=require("../SERVICES/revenue/ReplacementContactBackfillService");

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"miles-replacement-backfill-"));
  const source={async listEmails(){return {items:[
    {id:"historic-1",thread_id:"thread-1",timestamp_created:"2026-08-20T13:18:00Z",subject:"Automatic reply: Build revenue",body:{text:"The prior contact is no longer with our company. Please direct all future inquiries to New Person at new.person@example.com."},from_address_email:"old.person@example.com",campaign_id:"campaign-1",lead_id:"lead-old",is_auto_reply:1},
    {id:"historic-2",thread_id:"thread-2",timestamp_created:"2026-08-20T13:19:00Z",subject:"Out of office",body:{text:"I am out of office until Monday."},from_address_email:"ooo@example.com",campaign_id:"campaign-2",lead_id:"lead-ooo",is_auto_reply:1}
  ],next_starting_after:null};}};

  const first=new Backfill({rootDir:root,emailSource:source,lookbackDays:90,maxPages:2});
  const r1=await first.runOnce();
  assert.strictEqual(r1.ok,true);
  assert.strictEqual(r1.fetched.rows,2);
  assert.strictEqual(r1.detected,1);
  assert.strictEqual(r1.recovered,1);

  const queuePath=path.join(root,"DATA/runtime/revenue/replies/replacement_contact_queue.json");
  const q1=JSON.parse(fs.readFileSync(queuePath,"utf8"));
  assert.strictEqual(q1.length,1);
  assert.strictEqual(q1[0].replacementEmail,"new.person@example.com");
  assert.strictEqual(q1[0].departedContactEmail,"old.person@example.com");

  const second=new Backfill({rootDir:root,emailSource:source,lookbackDays:90,maxPages:2});
  const r2=await second.runOnce();
  assert.strictEqual(r2.recovered,1);
  const q2=JSON.parse(fs.readFileSync(queuePath,"utf8"));
  assert.strictEqual(q2.length,1,"backfill must be idempotent by replacement email + campaign");

  const suppression=JSON.parse(fs.readFileSync(path.join(root,"DATA/runtime/revenue/replies/global_suppression_master.json"),"utf8"));
  assert.strictEqual(suppression.entries.filter(row=>row.email==="old.person@example.com").length,1,"departed suppression must be idempotent");

  fs.rmSync(root,{recursive:true,force:true});
  console.log("PASS replacement_contact_backfill_test");
})().catch(error=>{console.error(error);process.exitCode=1;});
