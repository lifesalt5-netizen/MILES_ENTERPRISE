"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.P2GC_CUSTOMER_DATA_DIR || path.join(ROOT, "DATA", "customer_delivery");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function now() { return new Date().toISOString(); }
function makeId(prefix) { return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`; }
function clean(v) { return v == null ? null : String(v).trim(); }
function array(v) { return Array.isArray(v) ? v : []; }
function money(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function defaultState() { return { version: 2, generatedAt: now(), prospects: [], clients: [], subscriptions: [], invoices: [], referrals: [], executiveBriefs: [] }; }
function uniqueStrings(values) { return [...new Set(array(values).map(clean).filter(Boolean))]; }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { return fallback; }
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  try { fs.renameSync(tmp, file); }
  catch { fs.copyFileSync(tmp, file); try { fs.unlinkSync(tmp); } catch {} }
}

class P2GCCustomerDeliveryService {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) atomicWrite(STATE_FILE, defaultState());
  }

  load() {
    const state = readJson(STATE_FILE, defaultState());
    for (const k of ["prospects","clients","subscriptions","invoices","referrals","executiveBriefs"]) state[k] = array(state[k]);
    return state;
  }
  save(state) { state.version = Math.max(2,Number(state.version||1)); state.generatedAt = now(); atomicWrite(STATE_FILE, state); return state; }

  healthCheck() {
    const s = this.load();
    return {
      ok:true, service:"P2GC_CUSTOMER_DELIVERY", status:"HEALTHY", generatedAt:now(), stateFile:STATE_FILE,
      capabilities:["crm","lead_scoring","meeting_pipeline","client_onboarding","client_success","client_portal","revenue_command_center","executive_briefs","billing_ledger"],
      counts:{ prospects:s.prospects.length, clients:s.clients.length, subscriptions:s.subscriptions.length, invoices:s.invoices.length, referrals:s.referrals.length },
      billing:{ ledgerReady:true, externalChargeEnabled:false, externalChargeStatus:"FAIL_CLOSED_UNTIL_PAYMENT_PROVIDER_CONFIGURED" }
    };
  }

  scoreLead(input={}) {
    const checks=[
      {label:"Verified contact email present",pass:Boolean(clean(input.email)),weight:10},
      {label:"Phone present",pass:Boolean(clean(input.phone)),weight:5},
      {label:"Revenue segment assigned",pass:Boolean(clean(input.segment)),weight:10},
      {label:"Source identified",pass:Boolean(clean(input.source)),weight:5},
      {label:"Next action assigned",pass:Boolean(clean(input.nextAction)),weight:10},
      {label:"Meeting booked",pass:Boolean(clean(input.meetingAt)),weight:25},
      {label:"Blueprint engaged",pass:Boolean(clean(input.blueprintStatus)),weight:15},
      {label:"Proposal engaged",pass:Boolean(clean(input.proposalStatus)),weight:20}
    ];
    const score=checks.reduce((n,x)=>n+(x.pass?x.weight:0),0);
    const band=score>=75?"HOT":score>=50?"WARM":score>=25?"DEVELOPING":"EARLY";
    return {ok:true,score,band,model:"P2GC_PIPELINE_ENGAGEMENT_V1",checks,disclosure:"Engagement/readiness score based only on CRM evidence. It is not a win-probability or credit score."};
  }

  upsertProspect(input={}) {
    const s=this.load(); const email=clean(input.email)?.toLowerCase()||null; const company=clean(input.company||input.companyName);
    let r=s.prospects.find(x=>(input.id&&x.id===input.id)||(email&&x.email===email)||(company&&x.company?.toLowerCase()===company.toLowerCase()));
    const created=!r; if(!r){r={id:clean(input.id)||makeId("prospect"),createdAt:now()};s.prospects.push(r);}
    Object.assign(r,{company:company||r.company||null,contactName:clean(input.contactName)??r.contactName??null,email:email??r.email??null,phone:clean(input.phone)??r.phone??null,source:clean(input.source)??r.source??null,segment:clean(input.segment)??r.segment??null,stage:clean(input.stage)||r.stage||"PROSPECT",nextAction:clean(input.nextAction)??r.nextAction??null,meetingAt:clean(input.meetingAt)??r.meetingAt??null,blueprintStatus:clean(input.blueprintStatus)??r.blueprintStatus??null,proposalStatus:clean(input.proposalStatus)??r.proposalStatus??null,pipelineValue:input.pipelineValue==null?money(r.pipelineValue):money(input.pipelineValue),owner:clean(input.owner)??r.owner??"MILES",updatedAt:now()});
    if(input.score==null){const scored=this.scoreLead(r);r.score=scored.score;r.scoreBand=scored.band;r.scoreModel=scored.model;r.scoreUpdatedAt=now();}
    else {r.score=Number(input.score);r.scoreBand=clean(input.scoreBand)||r.scoreBand||"MANUAL";r.scoreModel="MANUAL";r.scoreUpdatedAt=now();}
    this.save(s); return {ok:true,created,prospect:r};
  }

  upsertClient(input={}) {
    const s=this.load(); const company=clean(input.company||input.companyName);
    let r=s.clients.find(x=>(input.id&&x.id===input.id)||(input.prospectId&&x.prospectId===input.prospectId)||(company&&x.company?.toLowerCase()===company.toLowerCase()));
    const created=!r; if(!r){r={id:clean(input.id)||makeId("client"),createdAt:now()};s.clients.push(r);}
    Object.assign(r,{prospectId:clean(input.prospectId)??r.prospectId??null,company:company||r.company||null,contactName:clean(input.contactName)??r.contactName??null,email:clean(input.email)?.toLowerCase()??r.email??null,phone:clean(input.phone)??r.phone??null,status:clean(input.status)||r.status||"ACTIVE",servicePlan:clean(input.servicePlan)??r.servicePlan??null,onboardingStatus:clean(input.onboardingStatus)||r.onboardingStatus||"NOT_STARTED",onboardingStartedAt:clean(input.onboardingStartedAt)??r.onboardingStartedAt??null,onboardingCompletedAt:clean(input.onboardingCompletedAt)??r.onboardingCompletedAt??null,blueprint:input.blueprint??r.blueprint??null,opportunities:array(input.opportunities??r.opportunities),vehicles:array(input.vehicles??r.vehicles),recommendations:array(input.recommendations??r.recommendations),deliverables:array(input.deliverables??r.deliverables),tasks:array(input.tasks??r.tasks),renewalDate:clean(input.renewalDate)??r.renewalDate??null,updatedAt:now()});
    if(r.prospectId){const p=s.prospects.find(x=>x.id===r.prospectId);if(p){p.stage="CLIENT";p.updatedAt=now();}}
    this.save(s); return {ok:true,created,client:r};
  }

  startOnboarding(input={}) {
    const clientId=clean(input.clientId); if(!clientId) throw new Error("clientId is required");
    const s=this.load(); const client=s.clients.find(x=>x.id===clientId); if(!client) throw new Error(`Unknown clientId: ${clientId}`);
    const defaults=["Confirm kickoff and primary client contact","Validate company/SAM/vehicle profile","Attach or refresh Executive Government Growth Blueprint","Confirm priority agencies, opportunities, and teaming targets","Confirm 30/60/90-day execution plan and reporting cadence"];
    const checklist=uniqueStrings(array(input.checklist).length?input.checklist:defaults);
    client.tasks=uniqueStrings([...array(client.tasks),...checklist]);
    client.onboardingStatus="IN_PROGRESS";
    client.onboardingStartedAt=client.onboardingStartedAt||now();
    client.updatedAt=now();
    this.save(s);
    return {ok:true,status:"ONBOARDING_IN_PROGRESS",clientId,checklist,client};
  }

  completeOnboarding(input={}) {
    const clientId=clean(input.clientId); if(!clientId) throw new Error("clientId is required");
    const s=this.load(); const client=s.clients.find(x=>x.id===clientId); if(!client) throw new Error(`Unknown clientId: ${clientId}`);
    client.onboardingStatus="COMPLETE"; client.onboardingStartedAt=client.onboardingStartedAt||now(); client.onboardingCompletedAt=now(); client.updatedAt=now(); this.save(s);
    return {ok:true,status:"ONBOARDING_COMPLETE",clientId,client};
  }

  upsertSubscription(input={}) {
    const s=this.load(); if(!input.clientId) throw new Error("clientId is required"); if(!s.clients.some(x=>x.id===input.clientId)) throw new Error(`Unknown clientId: ${input.clientId}`);
    let r=s.subscriptions.find(x=>(input.id&&x.id===input.id)||(x.clientId===input.clientId&&x.status==="ACTIVE")); const created=!r;
    if(!r){r={id:clean(input.id)||makeId("sub"),clientId:input.clientId,createdAt:now()};s.subscriptions.push(r);}
    Object.assign(r,{plan:clean(input.plan)||r.plan||"CUSTOM",monthlyAmount:input.monthlyAmount==null?money(r.monthlyAmount):money(input.monthlyAmount),status:clean(input.status)||r.status||"ACTIVE",startDate:clean(input.startDate)||r.startDate||now().slice(0,10),renewalDate:clean(input.renewalDate)??r.renewalDate??null,paymentProvider:clean(input.paymentProvider)??r.paymentProvider??null,externalSubscriptionId:clean(input.externalSubscriptionId)??r.externalSubscriptionId??null,updatedAt:now()});
    this.save(s); return {ok:true,created,subscription:r,externalChargeEnabled:false};
  }

  createInvoice(input={}) {
    const s=this.load(); if(!input.clientId) throw new Error("clientId is required");
    const r={id:makeId("inv"),clientId:input.clientId,subscriptionId:clean(input.subscriptionId),amount:money(input.amount),status:clean(input.status)||"DRAFT",dueDate:clean(input.dueDate),description:clean(input.description),createdAt:now(),updatedAt:now(),externalChargeAttempted:false};
    s.invoices.push(r); this.save(s); return {ok:true,invoice:r,externalChargeEnabled:false};
  }

  addReferral(input={}) {
    const s=this.load(); const r={id:makeId("ref"),clientId:clean(input.clientId),company:clean(input.company),contactName:clean(input.contactName),email:clean(input.email)?.toLowerCase()||null,status:clean(input.status)||"NEW",createdAt:now(),updatedAt:now()};
    s.referrals.push(r); this.save(s); return {ok:true,referral:r};
  }

  portal(clientId) {
    const s=this.load(); const client=s.clients.find(x=>x.id===clientId); if(!client) return {ok:false,status:"NOT_FOUND",clientId};
    const subscriptions=s.subscriptions.filter(x=>x.clientId===clientId); const invoices=s.invoices.filter(x=>x.clientId===clientId); const referrals=s.referrals.filter(x=>x.clientId===clientId);
    return {ok:true,status:"READY",generatedAt:now(),client,blueprint:client.blueprint,opportunities:client.opportunities,vehicles:client.vehicles,deliverables:client.deliverables,recommendations:client.recommendations,tasks:client.tasks,subscriptions,invoices,referrals};
  }

  meetingPipeline() {
    const s=this.load(); const current=Date.now();
    const meetings=s.prospects.filter(x=>x.meetingAt).map(x=>{const when=new Date(x.meetingAt).getTime();return{id:x.id,company:x.company,contactName:x.contactName,email:x.email,meetingAt:x.meetingAt,stage:x.stage,score:x.score??null,scoreBand:x.scoreBand??null,nextAction:x.nextAction,status:Number.isFinite(when)&&when>=current?"UPCOMING":"PAST_OR_DUE"};}).sort((a,b)=>String(a.meetingAt).localeCompare(String(b.meetingAt)));
    return {ok:true,status:"READY",generatedAt:now(),metrics:{meetingsBooked:meetings.length,upcoming:meetings.filter(x=>x.status==="UPCOMING").length,pastOrDue:meetings.filter(x=>x.status==="PAST_OR_DUE").length},meetings};
  }

  clientSuccessDashboard() {
    const s=this.load(); const current=Date.now();
    const clients=s.clients.filter(x=>x.status==="ACTIVE").map(client=>{
      const renewal=client.renewalDate?new Date(client.renewalDate).getTime():null;
      const renewalOverdue=Number.isFinite(renewal)&&renewal<current;
      const onboardingIncomplete=client.onboardingStatus!=="COMPLETE";
      const noExecutionPlan=array(client.tasks).length===0;
      const noRecommendations=array(client.recommendations).length===0;
      const reasons=uniqueStrings([renewalOverdue?"Renewal date is overdue":null,onboardingIncomplete?"Onboarding is incomplete":null,noExecutionPlan?"No client execution tasks are recorded":null,noRecommendations?"No current recommendations are recorded":null]);
      const risk=renewalOverdue?"HIGH":reasons.length>=2?"MEDIUM":reasons.length?"WATCH":"LOW";
      return {clientId:client.id,company:client.company,risk,reasons,onboardingStatus:client.onboardingStatus,renewalDate:client.renewalDate||null,deliverables:array(client.deliverables).length,tasks:array(client.tasks).length,recommendations:array(client.recommendations).length};
    });
    const rank={HIGH:4,MEDIUM:3,WATCH:2,LOW:1};clients.sort((a,b)=>(rank[b.risk]||0)-(rank[a.risk]||0));
    return {ok:true,status:"READY",generatedAt:now(),metrics:{activeClients:clients.length,highRisk:clients.filter(x=>x.risk==="HIGH").length,attentionRequired:clients.filter(x=>x.risk!=="LOW").length},clients,disclosure:"Operational client-health signals are derived only from onboarding, renewal, task, deliverable, and recommendation records."};
  }

  revenueCommandCenter() {
    const s=this.load(); const activeSubs=s.subscriptions.filter(x=>x.status==="ACTIVE"); const prospects=s.prospects.filter(x=>x.stage!=="CLIENT");
    return {ok:true,status:"READY",generatedAt:now(),metrics:{prospects:prospects.length,meetingsBooked:s.prospects.filter(x=>x.meetingAt).length,blueprints:s.prospects.filter(x=>x.blueprintStatus).length,proposals:s.prospects.filter(x=>x.proposalStatus).length,activeClients:s.clients.filter(x=>x.status==="ACTIVE").length,monthlyRecurringRevenue:money(activeSubs.reduce((n,x)=>n+money(x.monthlyAmount),0)),pipelineValue:money(prospects.reduce((n,x)=>n+money(x.pipelineValue),0)),openInvoices:s.invoices.filter(x=>!["PAID","VOID"].includes(x.status)).length,renewalsDue:s.clients.filter(x=>x.renewalDate).length,referrals:s.referrals.length},pipeline:prospects,clients:s.clients,subscriptions:activeSubs};
  }

  executiveBrief(clientId) {
    const portal=this.portal(clientId); if(!portal.ok) return portal;
    const brief={id:makeId("brief"),clientId,generatedAt:now(),company:portal.client.company,newOpportunities:portal.opportunities,recompetes:array(portal.client.recompetes),vehicleRecommendations:portal.vehicles,agencyChanges:array(portal.client.agencyChanges),competitiveChanges:array(portal.client.competitiveChanges),executiveRecommendations:portal.recommendations,deliverables:portal.deliverables,nextActions:portal.tasks};
    const s=this.load(); s.executiveBriefs.push(brief); this.save(s); return {ok:true,status:"READY",brief};
  }

  list(kind) { const s=this.load(); if(!Object.prototype.hasOwnProperty.call(s,kind)) throw new Error(`Unknown collection: ${kind}`); return {ok:true,items:array(s[kind])}; }
}

module.exports = new P2GCCustomerDeliveryService();
