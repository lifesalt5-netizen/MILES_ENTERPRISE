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
  const futureMeeting=new Date(Date.now()+86400000).toISOString();
  const prospect=service.upsertProspect({company:"Acceptance Prospect LLC",contactName:"Test Executive",email:"acceptance@example.test",phone:"555-0100",source:"CI",segment:"GSA",stage:"MEETING_BOOKED",nextAction:"Run Blueprint demo",meetingAt:futureMeeting,blueprintStatus:"READY",proposalStatus:"SENT",pipelineValue:7500}).prospect;
  add("CRM prospect created",Boolean(prospect?.id),prospect?.id);
  add("lead scoring executes from CRM evidence",prospect.score===100&&prospect.scoreBand==="HOT"&&prospect.scoreModel==="P2GC_PIPELINE_ENGAGEMENT_V1",`score=${prospect.score} band=${prospect.scoreBand}`);
  add("pipeline value persists",prospect.pipelineValue===7500,String(prospect.pipelineValue));
  const preConversionRevenue=service.revenueCommandCenter();
  add("active prospect contributes to sales pipeline",preConversionRevenue.metrics.pipelineValue===7500&&preConversionRevenue.metrics.prospects===1,`pipeline=${preConversionRevenue.metrics.pipelineValue}`);
  const meetings=service.meetingPipeline();
  add("meeting pipeline identifies booked meeting",meetings.ok&&meetings.metrics.meetingsBooked===1&&meetings.metrics.upcoming===1,`meetings=${meetings.metrics.meetingsBooked}`);

  const client=service.upsertClient({prospectId:prospect.id,company:prospect.company,contactName:prospect.contactName,email:prospect.email,onboardingStatus:"NOT_STARTED",servicePlan:"Growth Plus",blueprint:{status:"DELIVERED"},opportunities:[{id:"opp1",title:"Example Opportunity"}],vehicles:[{name:"GSA MAS",status:"ACTIVE"}],recommendations:["Pursue target agency"],deliverables:["Blueprint"],tasks:[],renewalDate:"2027-08-15"}).client;
  add("prospect converts to client",Boolean(client?.id),client?.id);
  const postConversionRevenue=service.revenueCommandCenter();
  add("converted client exits active sales pipeline",postConversionRevenue.metrics.pipelineValue===0&&postConversionRevenue.metrics.prospects===0&&postConversionRevenue.pipeline.length===0,`pipeline=${postConversionRevenue.metrics.pipelineValue}`);
  const onboarding=service.startOnboarding({clientId:client.id});
  add("client onboarding workflow starts",onboarding.ok&&onboarding.status==="ONBOARDING_IN_PROGRESS"&&onboarding.checklist.length>=5,`tasks=${onboarding.checklist.length}`);
  const completed=service.completeOnboarding({clientId:client.id});
  add("client onboarding can complete",completed.ok&&completed.client.onboardingStatus==="COMPLETE"&&Boolean(completed.client.onboardingCompletedAt));
  const clientSuccess=service.clientSuccessDashboard();
  add("client success dashboard executes",clientSuccess.ok&&clientSuccess.metrics.activeClients===1&&clientSuccess.clients[0].risk==="LOW",clientSuccess.clients[0].risk);

  const sub=service.upsertSubscription({clientId:client.id,plan:"Growth Plus",monthlyAmount:5000,renewalDate:"2027-08-15"}).subscription;
  add("subscription ledger created",sub.monthlyAmount===5000,`mrr=${sub.monthlyAmount}`);
  const inv=service.createInvoice({clientId:client.id,subscriptionId:sub.id,amount:5000,dueDate:"2026-09-01",description:"Growth Plus monthly service"}).invoice;
  add("invoice ledger created without external charge",inv.amount===5000&&inv.externalChargeAttempted===false,inv.id);
  const portal=service.portal(client.id);
  add("client portal aggregates delivery truth",portal.ok&&portal.opportunities.length===1&&portal.subscriptions.length===1&&portal.invoices.length===1);
  const revenue=service.revenueCommandCenter();
  add("revenue command center calculates MRR",revenue.metrics.monthlyRecurringRevenue===5000,String(revenue.metrics.monthlyRecurringRevenue));
  add("revenue command center excludes converted pipeline value",revenue.metrics.pipelineValue===0&&revenue.metrics.prospects===0,String(revenue.metrics.pipelineValue));
  const brief=service.executiveBrief(client.id);
  add("automated executive brief generated",brief.ok&&brief.brief.company===client.company,brief.brief?.id);
  const health=service.healthCheck();
  add("operational capability registry exposed",["lead_scoring","meeting_pipeline","client_onboarding","client_success"].every(x=>health.capabilities.includes(x)),health.capabilities.join(","));
  add("billing remains fail-closed",health.billing.externalChargeEnabled===false,health.billing.externalChargeStatus);

  const child=require("child_process").spawn(process.execPath,[path.join(__dirname,"..","StartP2GCCustomerDelivery.js")],{env:{...process.env},stdio:["ignore","pipe","pipe"]});
  try{
    await new Promise(r=>setTimeout(r,1200));
    const h=await request("GET","/api/health"); add("customer delivery API responds",h.status===200&&h.json.ok===true,`http=${h.status}`);
    const r=await request("GET","/api/revenue"); add("revenue command center API responds",r.status===200&&r.json.metrics.monthlyRecurringRevenue===5000&&r.json.metrics.pipelineValue===0,`http=${r.status}`);
    const m=await request("GET","/api/meetings"); add("meeting pipeline API responds",m.status===200&&m.json.metrics.meetingsBooked===1,`http=${m.status}`);
    const cs=await request("GET","/api/client-success"); add("client success API responds",cs.status===200&&cs.json.metrics.activeClients===1,`http=${cs.status}`);
    const p=await request("GET",`/api/portal?clientId=${encodeURIComponent(client.id)}`); add("client portal API responds",p.status===200&&p.json.ok===true,`http=${p.status}`);
  } finally { child.kill(); }

  const report={ok:checks.every(x=>x.ok),generatedAt:new Date().toISOString(),checks};
  console.log(`=== P2GC CUSTOMER DELIVERY ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);
  process.exitCode=report.ok?0:1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
