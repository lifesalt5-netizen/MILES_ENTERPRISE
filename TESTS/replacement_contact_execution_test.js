"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const RevenueMissionSourceService=require("../SERVICES/RevenueMissionSourceService");
const BusinessOperationsBridgeService=require("../SERVICES/BusinessOperationsBridgeService");
const contracts=require("../CORE/ExecutionActionContracts");

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"miles-replacement-exec-"));
  try{
    const queuePath=path.join(root,"DATA/runtime/revenue/replies/replacement_contact_queue.json");
    const businessQueuePath=path.join(root,"state","business_operations_queue.json");
    fs.mkdirSync(path.dirname(queuePath),{recursive:true});
    fs.writeFileSync(queuePath,JSON.stringify([
      {
        detected:true,
        departedContactEmail:"old.person@example.com",
        replacementEmail:"new.person@example.com",
        replacementName:"New Person",
        evidenceType:"EXPLICIT_REPLACEMENT_CONTACT_NOTICE",
        evidence:"The prior contact is no longer with our company. Please direct all future inquiries to New Person at new.person@example.com.",
        campaignId:"campaign-123",
        sourceEmailId:"message-123",
        status:"VERIFICATION_REQUIRED"
      },
      {
        detected:true,
        departedContactEmail:"old.person@example.com",
        replacementEmail:"new.person@other.example",
        replacementName:"Other Person",
        evidenceType:"EXPLICIT_REPLACEMENT_CONTACT_NOTICE",
        evidence:"Please contact Other Person instead.",
        campaignId:"campaign-123",
        sourceEmailId:"message-124",
        status:"VERIFICATION_REQUIRED"
      }
    ],null,2));

    const service=new RevenueMissionSourceService({rootDir:root});
    const read=service.readCandidates();
    const replacements=read.candidates.filter(row=>row.source==="replacement_contacts");
    assert.strictEqual(replacements.length,2);

    const same=replacements.find(row=>row.replacementEmail==="new.person@example.com");
    assert.strictEqual(same.status,"READY");
    assert.strictEqual(same.provider,"INSTANTLY");
    assert.strictEqual(same.connector,"INSTANTLY");
    assert.strictEqual(same.action,"createLead");
    assert.strictEqual(same.type,"createLead");
    assert.strictEqual(same.email,"new.person@example.com");
    assert.strictEqual(same.campaign,"campaign-123");
    assert.strictEqual(same.sourceVerification,"EXPLICIT_COMPANY_REDIRECT");
    assert.strictEqual(same.sameOrganizationDomain,true);
    assert.strictEqual(same.requiresKevin,false);
    assert.strictEqual(same.custom_variables.replacement_of,"old.person@example.com");
    assert.strictEqual(contracts.resolveConnectorAction(same.connector,same.action).supported,true);

    const cross=replacements.find(row=>row.replacementEmail==="new.person@other.example");
    assert.strictEqual(cross.status,"VERIFICATION_REQUIRED");
    assert.strictEqual(cross.action,"VERIFY_REPLACEMENT_CONTACT");
    assert.strictEqual(cross.sameOrganizationDomain,false);

    const added=[];
    const fakeTaskQueue={
      add(type,payload,priority){
        const task={id:`TASK-REPLACEMENT-${added.length+1}`,type,payload,priority,status:"QUEUED"};
        added.push(task);
        return task;
      }
    };
    const fakePreflight={
      evaluate({operation,task}){
        const resolved=contracts.resolveConnectorAction(operation.connector,task.type);
        return {
          ok:resolved.supported,
          allowedToQueue:resolved.supported,
          status:resolved.supported?"READY":"BLOCKED",
          blockers:resolved.supported?[]:[{area:"ACTION",code:"UNSUPPORTED"}]
        };
      }
    };

    const bridge=new BusinessOperationsBridgeService({
      rootDir:root,
      taskQueue:fakeTaskQueue,
      commandPreflight:fakePreflight,
      revenueMissionSource:service,
      queueFile:businessQueuePath,
      marketingQueueFile:path.join(root,"missing_marketing_queue.json")
    });

    // Exercise the actual COO-owned path: import replacement revenue work,
    // select executable operations, preflight, enqueue, and persist BRIDGED.
    const first=await bridge.runOnce();
    assert.strictEqual(first.ok,true);
    assert.strictEqual(first.operationsQueued,1);
    assert.strictEqual(first.operationsFailed,0);
    assert.strictEqual(added.length,1);
    assert.strictEqual(added[0].type,"createLead");
    assert.strictEqual(added[0].payload.connector,"INSTANTLY");
    assert.strictEqual(added[0].payload.action,"createLead");
    assert.strictEqual(added[0].payload.email,"new.person@example.com");
    assert.strictEqual(added[0].payload.campaign,"campaign-123");
    assert.strictEqual(added[0].payload.custom_variables.replacement_of,"old.person@example.com");

    const persisted=JSON.parse(fs.readFileSync(businessQueuePath,"utf8"));
    const replacementOps=(persisted.operations||[]).filter(row=>row.source==="replacement_contacts");
    assert.strictEqual(replacementOps.length,2);
    const executable=replacementOps.find(row=>row.replacementEmail==="new.person@example.com");
    const held=replacementOps.find(row=>row.replacementEmail==="new.person@other.example");
    assert.strictEqual(executable.status,"BRIDGED");
    assert.strictEqual(executable.taskQueueStatus,"QUEUED");
    assert.strictEqual(executable.taskId,"TASK-REPLACEMENT-1");
    assert.strictEqual(held.status,"VERIFICATION_REQUIRED");

    // The next COO cycle must not create a duplicate Instantly lead task.
    const second=await bridge.runOnce();
    assert.strictEqual(second.operationsQueued,0);
    assert.strictEqual(second.operationsFailed,0);
    assert.strictEqual(added.length,1);

    console.log("PASS replacement_contact_execution_test");
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{
  console.error(error.stack||error);
  process.exitCode=1;
});
