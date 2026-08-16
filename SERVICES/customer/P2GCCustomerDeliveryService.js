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
function defaultState() { return { version: 1, generatedAt: now(), prospects: [], clients: [], subscriptions: [], invoices: [], referrals: [], executiveBriefs: [] }; }

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
  save(state) { state.generatedAt = now(); atomicWrite(STATE_FILE, state); return state; }

  healthCheck() {
    const s = this.load();
    return {
      ok: true, service: "P2GC_CUSTOMER_DELIVERY", status: "HEALTHY", generatedAt: now(), stateFile: STATE_FILE,
      counts: { prospects:s.prospects.length, clients:s.clients.length, subscriptions:s.subscriptions.length, invoices:s.invoices.length, referrals:s.referrals.length },
      billing: { ledgerReady:true, externalChargeEnabled:false, externalChargeStatus:"FAIL_CLOSED_UNTIL_PAYMENT_PROVIDER_CONFIGURED" }
    };
  }

  upsertProspect(input={}) {
    const s=this.load(); const email=clean(input.email)?.toLowerCase()||null; const company=clean(input.company||input.companyName);
    let r=s.prospects.find(x=>(input.id&&x.id===input.id)||(email&&x.email===email)||(company&&x.company?.toLowerCase()===company.toLowerCase()));
    const created=!r; if(!r){r={id:clean(input.id)||makeId("prospect"),createdAt:now()};s.prospects.push(r);}
    Object.assign(r,{company:company||r.company||null,contactName:clean(input.contactName)??r.contactName??null,email:email??r.email??null,phone:clean(input.phone)??r.phone??null,source:clean(input.source)??r.source??null,segment:clean(input.segment)??r.segment??null,stage:clean(input.stage)||r.stage||"PROSPECT",score:input.score==null?(r.score??null):Number(input.score),nextAction:clean(input.nextAction)??r.nextAction??null,meetingAt:clean(input.meetingAt)??r.meetingAt??null,blueprintStatus:clean(input.blueprintStatus)??r.blueprintStatus??null,proposalStatus:clean(input.proposalStatus)??r.proposalStatus??null,owner:clean(input.owner)??r.owner??"MILES",updatedAt:now()});
    this.save(s); return {ok:true,created,prospect:r};
  }

  upsertClient(input={}) {
    const s=this.load(); const company=clean(input.company||input.companyName);
    let r=s.clients.find(x=>(input.id&&x.id===input.id)||(input.prospectId&&x.prospectId===input.prospectId)||(company&&x.company?.toLowerCase()===company.toLowerCase()));
    const created=!r; if(!r){r={id:clean(input.id)||makeId("client"),createdAt:now()};s.clients.push(r);}
    Object.assign(r,{prospectId:clean(input.prospectId)??r.prospectId??null,company:company||r.company||null,contactName:clean(input.contactName)??r.contactName??null,email:clean(input.email)?.toLowerCase()??r.email??null,phone:clean(input.phone)??r.phone??null,status:clean(input.status)||r.status||"ACTIVE",servicePlan:clean(input.servicePlan)??r.servicePlan??null,onboardingStatus:clean(input.onboardingStatus)||r.onboardingStatus||"NOT_STARTED",blueprint:input.blueprint??r.blueprint??null,opportunities:array(input.opportunities??r.opportunities),vehicles:array(input.vehicles??r.vehicles),recommendations:array(input.recommendations??r.recommendations),deliverables:array(input.deliverables??r.deliverables),tasks:array(input.tasks??r.tasks),renewalDate:clean(input.renewalDate)??r.renewalDate??null,updatedAt:now()});
    if(r.prospectId){const p=s.prospects.find(x=>x.id===r.prospectId);if(p){p.stage="CLIENT";p.updatedAt=now();}}
    this.save(s); return {ok:true,created,client:r};
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

  revenueCommandCenter() {
    const s=this.load(); const activeSubs=s.subscriptions.filter(x=>x.status==="ACTIVE"); const prospects=s.prospects.filter(x=>x.stage!=="CLIENT");
    return {ok:true,status:"READY",generatedAt:now(),metrics:{prospects:prospects.length,meetingsBooked:s.prospects.filter(x=>x.meetingAt).length,blueprints:s.prospects.filter(x=>x.blueprintStatus).length,proposals:s.prospects.filter(x=>x.proposalStatus).length,activeClients:s.clients.filter(x=>x.status==="ACTIVE").length,monthlyRecurringRevenue:money(activeSubs.reduce((n,x)=>n+money(x.monthlyAmount),0)),pipelineValue:money(s.prospects.reduce((n,x)=>n+money(x.pipelineValue),0)),openInvoices:s.invoices.filter(x=>!["PAID","VOID"].includes(x.status)).length,renewalsDue:s.clients.filter(x=>x.renewalDate).length,referrals:s.referrals.length},pipeline:s.prospects,clients:s.clients,subscriptions:activeSubs};
  }

  executiveBrief(clientId) {
    const portal=this.portal(clientId); if(!portal.ok) return portal;
    const brief={id:makeId("brief"),clientId,generatedAt:now(),company:portal.client.company,newOpportunities:portal.opportunities,recompetes:array(portal.client.recompetes),vehicleRecommendations:portal.vehicles,agencyChanges:array(portal.client.agencyChanges),competitiveChanges:array(portal.client.competitiveChanges),executiveRecommendations:portal.recommendations,deliverables:portal.deliverables,nextActions:portal.tasks};
    const s=this.load(); s.executiveBriefs.push(brief); this.save(s); return {ok:true,status:"READY",brief};
  }

  list(kind) { const s=this.load(); if(!Object.prototype.hasOwnProperty.call(s,kind)) throw new Error(`Unknown collection: ${kind}`); return {ok:true,items:array(s[kind])}; }
}

module.exports = new P2GCCustomerDeliveryService();
