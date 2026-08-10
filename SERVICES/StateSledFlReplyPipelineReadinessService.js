'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, 'CONFIG', 'state_sled_fl_reply_pipeline_readiness_rules.json');

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function searchText(file, patterns) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  return patterns.some(p => text.toLowerCase().includes(String(p).toLowerCase()));
}

function discoverCapabilities(rules) {
  const providerRouter = path.join(ROOT, 'SERVICES', 'ProviderRouterService.js');
  const instantConnector = path.join(ROOT, 'CONNECTORS', 'INSTANTLY', 'connector.js');

  const candidates = {
    instantlyReadReplies: searchText(instantConnector, ['reply', 'inbox', 'unibox']),
    crmIdentityUpsert: searchText(providerRouter, ['crm']) || exists('SERVICES/CRMProvider.js'),
    crmStageUpdate: searchText(providerRouter, ['pipeline', 'crm']) || exists('SERVICES/CRMProvider.js'),
    googleWorkspaceRead: searchText(providerRouter, ['googleworkspace', 'gmail']) || exists('PROVIDERS/GoogleWorkspaceProvider.js'),
    meetingRouting: searchText(providerRouter, ['calendar', 'meeting']) || exists('PROVIDERS/GoogleWorkspaceProvider.js')
  };

  const checks = {};
  for (const [key, required] of Object.entries(rules.requiredCapabilities || {})) {
    checks[key] = required ? candidates[key] === true : true;
  }

  return { candidates, checks };
}

async function run() {
  const rules = loadRules();
  const capability = discoverCapabilities(rules);
  const failedChecks = Object.entries(capability.checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);

  const result = {
    ok: true,
    gate: rules.gate,
    state: rules.state,
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    canonicalStages: rules.canonicalStages,
    replyClasses: rules.replyClasses,
    discoveredCapabilities: capability.candidates,
    checks: capability.checks,
    failedChecks,
    readyForRoutingImplementation: failedChecks.length === 0,
    safety: rules.safety,
    mutationAttempted: false
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'REPLY_PIPELINE_READINESS');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_REPLY_PIPELINE_READINESS.json');
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  result.outputFile = outputFile;

  return result;
}

module.exports = { run, discoverCapabilities };
