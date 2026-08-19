'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crm = require('./CanonicalCrmService');

const ROOT = process.cwd();
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'CONFIG', 'state_sled_fl_governed_crm_write_rules.json'), 'utf8'));

function loadRoutingArtifact() {
  const file = path.join(ROOT, RULES.routingArtifact);
  if (!fs.existsSync(file)) throw new Error(`Routing artifact not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed.summary || parsed;
}

function execute(options = {}) {
  const authorization = String(options.authorization || process.env.MILES_STATE_SLED_CRM_WRITE_AUTH || '').trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_STATE_SLED_CRM_WRITE_LIVE || '').toLowerCase() === 'true';

  const routing = loadRoutingArtifact();
  const plannedRoutes = Array.isArray(routing.plannedRoutes) ? routing.plannedRoutes : [];

  if (authorization !== RULES.authorizationToken || !executeLive) {
    return {
      ok: true,
      gate: RULES.gate,
      authorized: false,
      executeLive: false,
      plannedRoutes: plannedRoutes.length,
      crmWritesExecuted: 0,
      safety: RULES.safety
    };
  }

  const writes = [];
  for (const route of plannedRoutes) {
    if (!RULES.allowedReplyClasses.includes(String(route.classification || '').toUpperCase())) continue;
    if (!route.email) continue;

    const upsert = crm.upsertIdentity({
      email: route.email,
      source: 'STATE_SLED_FL_REPLY',
      campaignId: RULES.campaignId,
      campaignName: RULES.campaignName
    }, { source: 'P1.3V' });

    const targetStage = RULES.stageMap[String(route.classification || '').toUpperCase()] || route.proposedStage || 'Contacted';
    const stageResult = crm.updateStage({ email: route.email }, targetStage, {
      type: 'REPLY_CLASSIFICATION_ROUTE',
      source: 'P1.3V',
      classification: route.classification,
      campaignId: RULES.campaignId
    });

    writes.push({ email: route.email, classification: route.classification, targetStage, upsert, stageResult });
  }

  const summary = {
    ok: true,
    gate: RULES.gate,
    authorized: true,
    executeLive: true,
    plannedRoutes: plannedRoutes.length,
    crmWritesExecuted: writes.length,
    safety: RULES.safety
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'CRM_WRITE_EXECUTION');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_GOVERNED_CRM_WRITE_RESULT.json');
  fs.writeFileSync(outputFile, JSON.stringify({ summary, writes }, null, 2));
  summary.outputFile = outputFile;
  return summary;
}

module.exports = { execute, loadRoutingArtifact };
