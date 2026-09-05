'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const audit=fs.readFileSync(path.join(root,'SCRIPTS','AuditFederalSourceReadiness.js'),'utf8');
const stability=fs.readFileSync(path.join(root,'SCRIPTS','RunP2GCGrowthDemoStabilityAcceptance.js'),'utf8');

assert(audit.includes("P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS||'210000'"));
assert(audit.includes("require('./RunP2GCGrowthDemoStabilityAcceptance')"));
assert(audit.includes('DEFERRED_TO_ISOLATED_LIVE_RUNTIME_ACCEPTANCE'));
assert(!audit.includes("require('../SERVICES/demo/ExecutiveGrowthBlueprintDemoService')"),'federal readiness acceptance must not load a duplicate heavyweight demo model stack');
assert(!audit.includes("require('./AuditP2GCDemoUiSurface')"),'federal readiness acceptance must not run a second five-company matrix');
assert(stability.includes('async function runAcceptance()'));
assert(stability.includes('HEALTH_FAILED_DURING_ASSESSMENT'));
assert(stability.includes('P2GC_RUNTIME_RESTARTED_DURING_COMPANY'));
assert(stability.includes('P2GC_RUNTIME_CHANGED_OVER_ACCEPTANCE'));
assert(stability.includes("'/demo'"));
assert(stability.includes("'/app.js'"));
assert(stability.includes("'/styles.css'"));
assert(stability.includes('for(const company of Live.DEFAULT_COMPANIES)'));
assert(stability.includes('readOnly:true'));
assert(stability.includes('prospectSends:false'));
assert(stability.includes('providerMutations:false'));

console.log('P2GC_GROWTH_DEMO_STABILITY_ACCEPTANCE_CONTRACT_GREEN');
