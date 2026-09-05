'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const P2GCIntentLeadCanonicalService=require('../SERVICES/revenue/P2GCIntentLeadCanonicalService');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-intent-lead-'));
try{
  const now=()=>new Date('2026-09-05T12:00:00Z');
  const service=new P2GCIntentLeadCanonicalService({rootDir:root,now,maxSignalAgeDays:45});

  const generic=service.upsert({company:'Generic Gov Contractor LLC',website:'https://generic.example',sourcePlatform:'LinkedIn',sourceUrl:'https://linkedin.com/posts/1',originalPostDate:'2026-09-04',needSummary:'We won a government contract.',excerpt:'We won a government contract.',signalType:'GENERIC_GOVERNMENT_CONTRACTOR'});
  assert.strictEqual(generic.ok,false);
  assert(generic.failures.includes('NON_QUALIFYING_SIGNAL_TYPE'));
  assert.strictEqual(service.metrics().total,0);

  const first=service.upsert({
    company:'Acme Federal LLC',website:'https://acmefederal.example',contactName:'Jane Owner',title:'CEO',email:'jane@acmefederal.example',
    sourcePlatform:'LinkedIn',sourceUrl:'https://www.linkedin.com/posts/acme-gsa-help',originalPostDate:'2026-09-04',
    needSummary:'Needs help getting traction from an existing GSA Schedule.',excerpt:'We have a GSA Schedule but are not getting sales and need help figuring out what to do next.',
    signalType:'GSA_HELP',urgency:'CURRENT',fitRationale:'P2GC can diagnose schedule positioning, agency demand, SIN usage and near-term opportunity paths.'
  });
  assert.strictEqual(first.ok,true);
  assert.strictEqual(first.created,true);
  assert.strictEqual(first.record.leadTemperature,'HOT');
  assert.strictEqual(first.record.signals.length,1);
  assert.strictEqual(first.record.domain,'acmefederal.example');

  const duplicateSignal=service.upsert({
    company:'ACME FEDERAL, LLC',website:'https://www.acmefederal.example',contactName:'Jane Owner',email:'jane@acmefederal.example',
    sourcePlatform:'LinkedIn',sourceUrl:'https://www.linkedin.com/posts/acme-gsa-help',originalPostDate:'2026-09-04',
    needSummary:'Same signal re-read.',excerpt:'We have a GSA Schedule but are not getting sales and need help figuring out what to do next.',signalType:'GSA_HELP'
  });
  assert.strictEqual(duplicateSignal.ok,true);
  assert.strictEqual(duplicateSignal.created,false);
  assert.strictEqual(duplicateSignal.signalAdded,false);
  assert.strictEqual(duplicateSignal.record.signals.length,1);

  const secondSignal=service.upsert({
    company:'Acme Federal LLC',website:'https://acmefederal.example',contactName:'Jane Owner',email:'jane@acmefederal.example',
    sourcePlatform:'Reddit',sourceUrl:'https://www.reddit.com/r/govcon/comments/example',originalPostDate:'2026-09-05',
    needSummary:'Also asking how to find relevant federal opportunities.',excerpt:'How are small firms finding federal opportunities that actually match what they sell?',signalType:'OPPORTUNITY_HELP'
  });
  assert.strictEqual(secondSignal.ok,true);
  assert.strictEqual(secondSignal.created,false);
  assert.strictEqual(secondSignal.signalAdded,true);
  assert.strictEqual(secondSignal.record.signals.length,2);

  const stale=service.upsert({company:'Old Signal LLC',website:'https://oldsignal.example',sourcePlatform:'Forum',sourceUrl:'https://example.com/old',originalPostDate:'2025-01-01',needSummary:'Old request',excerpt:'Need help with SAM registration.',signalType:'SAM_HELP'});
  assert.strictEqual(stale.ok,false);
  assert(stale.failures.includes('SIGNAL_TOO_OLD'));

  const metrics=service.metrics();
  assert.strictEqual(metrics.total,1);
  assert.strictEqual(metrics.byTemperature.HOT,1);
  assert.strictEqual(metrics.byTemperature.WARM,0);
  assert.strictEqual(metrics.byTemperature.WATCH,0);

  const store=JSON.parse(fs.readFileSync(path.join(root,'DATA','runtime','revenue','intent_leads','canonical_intent_leads.json'),'utf8'));
  assert.strictEqual(store.records.length,1);
  const audit=fs.readFileSync(path.join(root,'DATA','runtime','revenue','intent_leads','canonical_intent_lead_audit.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.strictEqual(audit.length,3);
  assert.strictEqual(audit[1].signalAdded,false);

  console.log('P2GC_INTENT_LEAD_CANONICAL_GREEN');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
