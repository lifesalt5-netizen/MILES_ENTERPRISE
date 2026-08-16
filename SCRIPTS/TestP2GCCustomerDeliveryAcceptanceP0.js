"use strict";

const fs=require("fs");
const path=require("path");
const os=require("os");
const http=require("http");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"p2gc-customer-"));
process.env.P2GC_CUSTOMER_DATA_DIR=tmp;
process.env.P2GC_CUSTOMER_PORT="8793";
const service=require("../SERVICES/customer/P2GCCustomerDeliveryService");
const checks=[];
function add(name,ok,detail=null){checks.push({name,ok:Boolean(ok),detail});console.log(`[${ok?"PASS":"FAIL"}] ${name}${detail?` :: ${detail}`:""}`);}

function request(method,p,body=null){return new Promise((resolve,reject)=>{const payload=body?Buffer.from(JSON.stringify(body)):null;const req=http.request({hostname:"127.0.0.1",port:8793,path:p,method,headers:payload?{"Content-Type":"application/json","Content-Length":payload.length}:{}},res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{try{resolve({status:res.statusCode,json:JSON.parse(d||"{}")} )}catch(e){reject(e)}})});req.on("error",reject);if(payload)req.write(payload);req.end();});}

(async()=>{
  const prospect=service.upsertProspect({company:"Acceptance Prospect LLC",contactName:"Test Executive",email:"acceptance@example.test",source:"CI",stage:"MEETING_BOOKED",meetingAt:new Date().toISOString(),blueprintStatus:"READY",proposalStatus:"SENT"}).prospect;
  add("CRM prospect created",Boolean(prospect?.id),prospect?.id);
  const client=service.upsertClient({prospectId:prospect.id,company:prospect.company,contactName:prospect.contactName,email:prospect.email,onboardingStatus:"COMPLETE",servicePlan:"Growth Plus",blueprint:{status:"DELIVERED"},opportunities:[{id:"opp1",title:"Example Opportunity"}],vehicles:[{name:"GSA MAS",status:"ACTIVE"}],recommendations:["Pursue target agency"],deliverables:["Blueprint"],tasks:["Schedule capture review"]}).client;
  add("prospect converts to client",Boolean(client?.id),client?.id);
  const sub=service.upsertSubscription({clientId:client.id,plan:"Growth Plus",monthlyAmount:5000,renewalDate:"2027-08-15"}).subscription;
  add("subscription ledger created",sub.monthlyAmount===5000,`mrr=${sub.monthlyAmount}`);
  const inv=service.createInvoice({clientId:client.id,subscriptionId:sub.id,amount:5000,dueDate:"2026-09-01",description:"Growth Plus monthly service"}).invoice;
  add("invoice ledger created without external charge",inv.amount===5000&&inv.externalChargeAttempted===false,inv.id);
  const portal=service.portal(client.id);
  add("client portal aggregates delivery truth",portal.ok&&portal.opportunities.length===1&&portal.subscriptions.length===1&&portal.invoices.length===1);
  const revenue=service.revenueCommandCenter();
  add("revenue command center calculates MRR",revenue.metrics.monthlyRecurringRevenue===5000,String(revenue.metrics.monthlyRecurringRevenue));
  const brief=service.executiveBrief(client.id);
  add("automated executive brief generated",brief.ok&&brief.brief.company===client.company,brief.brief?.id);
  const health=service.healthCheck();
  add("billing remains fail-closed",health.billing.externalChargeEnabled===false,health.billing.externalChargeStatus);

  const child=require("child_process").spawn(process.execPath,[path.join(__dirname,"..","StartP2GCCustomerDelivery.js")],{env:{...process.env},stdio:["ignore","pipe","pipe"]});
  try{
    await new Promise(r=>setTimeout(r,1200));
    const h=await request("GET","/api/health"); add("customer delivery API responds",h.status===200&&h.json.ok===true,`http=${h.status}`);
    const r=await request("GET","/api/revenue"); add("revenue command center API responds",r.status===200&&r.json.metrics.monthlyRecurringRevenue===5000,`http=${r.status}`);
    const p=await request("GET",`/api/portal?clientId=${encodeURIComponent(client.id)}`); add("client portal API responds",p.status===200&&p.json.ok===true,`http=${p.status}`);
  } finally { child.kill(); }

  const report={ok:checks.every(x=>x.ok),generatedAt:new Date().toISOString(),checks};
  console.log(`=== P2GC CUSTOMER DELIVERY ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);
  process.exitCode=report.ok?0:1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
