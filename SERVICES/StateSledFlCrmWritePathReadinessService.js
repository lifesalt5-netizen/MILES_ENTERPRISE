'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT,'CONFIG','state_sled_fl_crm_write_path_rules.json'),'utf8'));

function discoverCapabilities() {
  const providerRouterPath = path.join(ROOT,'SERVICES','providers','ProviderRouter.js');
  const salesProviderPath = path.join(ROOT,'SERVICES','providers','SalesProvider.js');
  const crmCandidates = [
    path.join(ROOT,'SERVICES','CRMService.js'),
    path.join(ROOT,'SERVICES','CrmService.js'),
    path.join(ROOT,'SERVICES','SalesCRMService.js'),
    path.join(ROOT,'CONNECTORS','CRM','connector.js')
  ];

  const routerText = fs.existsSync(providerRouterPath) ? fs.readFileSync(providerRouterPath,'utf8') : '';
  const salesText = fs.existsSync(salesProviderPath) ? fs.readFileSync(salesProviderPath,'utf8') : '';
  const crmFiles = crmCandidates.filter(fs.existsSync);
  const crmText = crmFiles.map(f => fs.readFileSync(f,'utf8')).join('\n');
  const all = `${routerText}\n${salesText}\n${crmText}`.toLowerCase();

  const identity = /crm|pipeline/.test(all) && /upsert|create.*lead|create.*contact|identity/.test(all);
  const stage = /crm|pipeline/.test(all) && /stage|status/.test(all) && /update|set|advance/.test(all);

  return {
    crmIdentityUpsert: identity,
    crmStageUpdate: stage,
    evidenceFiles: [
      ...(fs.existsSync(providerRouterPath)?[providerRouterPath]:[]),
      ...(fs.existsSync(salesProviderPath)?[salesProviderPath]:[]),
      ...crmFiles
    ].map(f => path.relative(ROOT,f))
  };
}

async function run() {
  const caps = discoverCapabilities();
  const checks = {
    canonicalStagesFrozen: Array.isArray(RULES.canonicalStages) && RULES.canonicalStages.length === 11,
    crmIdentityUpsert: caps.crmIdentityUpsert,
    crmStageUpdate: caps.crmStageUpdate,
    safetyReadOnly: RULES.safety?.mutateCrm === false && RULES.safety?.sendReplies === false && RULES.safety?.createCalendarEvents === false && RULES.safety?.mutateInstantlyCampaigns === false
  };
  const failedChecks = Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
  const result = {
    ok: true,
    gate: RULES.gate,
    campaignId: RULES.campaignId,
    campaignName: RULES.campaignName,
    discoveredCapabilities: caps,
    checks,
    failedChecks,
    readyForCrmWriteImplementation: failedChecks.length === 0,
    safety: RULES.safety,
    mutationAttempted: false
  };
  const outDir = path.join(ROOT,'DATA','OUTBOUND','STATE_SLED','CRM_WRITE_PATH_READINESS');
  fs.mkdirSync(outDir,{recursive:true});
  const outFile = path.join(outDir,'STATE_SLED_FL_CRM_WRITE_PATH_READINESS.json');
  fs.writeFileSync(outFile,JSON.stringify(result,null,2));
  result.outputFile = outFile;
  return result;
}

module.exports = { run, discoverCapabilities };
