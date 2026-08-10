'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crm = require('./CanonicalCrmService');
const replyRouting = require('./StateSledFlReplyClassificationRoutingService');

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, 'CONFIG', 'state_sled_fl_reply_to_crm_rules.json');

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
}

function first(value, keys) {
  for (const key of keys) {
    const v = value?.[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function normalizeCandidate(candidate = {}, rules) {
  const classification = String(candidate.classification || candidate.replyClass || '').toUpperCase();
  const email = first(candidate, ['email', 'from_email', 'sender_email', 'leadEmail', 'contactEmail']);
  const company = first(candidate, ['company', 'company_name', 'legalName', 'legal_name']);
  const uei = first(candidate, ['uei', 'UEI']);
  const domain = first(candidate, ['domain', 'website', 'Website']);
  const proposedStage = rules.classToStage[classification] || 'Contacted';

  return {
    classification,
    email,
    company,
    uei,
    domain,
    proposedStage,
    meetingEligible: rules.meetingEligibleClasses.includes(classification),
    suppressionCandidate: rules.suppressionClasses.includes(classification),
    source: 'STATE_SLED_FL_REPLY',
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    raw: candidate
  };
}

async function run(options = {}) {
  const rules = loadRules();
  const executeCrmWrites = options.executeCrmWrites === true;

  if (executeCrmWrites && rules.safety?.allowAutomaticCrmWrites !== true) {
    throw new Error('P1.3U CRM writes are not authorized by this gate.');
  }

  const replyResult = await replyRouting.run();
  const candidates = Array.isArray(replyResult.routingCandidates) ? replyResult.routingCandidates : [];
  const normalized = candidates.map(c => normalizeCandidate(c, rules));

  const planned = normalized.map(item => ({
    email: item.email,
    classification: item.classification,
    proposedStage: item.proposedStage,
    meetingEligible: item.meetingEligible,
    suppressionCandidate: item.suppressionCandidate,
    identityReady: Boolean(item.email || item.uei || item.domain || item.company)
  }));

  const writes = [];
  if (executeCrmWrites) {
    for (const item of normalized) {
      const identity = crm.upsertIdentity({
        email: item.email,
        uei: item.uei,
        domain: item.domain,
        legalName: item.company,
        source: item.source,
        campaignId: item.campaignId,
        campaignName: item.campaignName
      });
      const stage = crm.updateStage(identity.id || identity.identityId, item.proposedStage, {
        source: 'P1.3U',
        classification: item.classification,
        campaignId: item.campaignId
      });
      writes.push({ identity, stage });
    }
  }

  const summary = {
    ok: true,
    gate: rules.gate,
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    repliesObserved: Number(replyResult.repliesObserved || 0),
    routingCandidates: normalized.length,
    plannedRoutes: planned,
    crmCapabilities: crm.getCapabilities(),
    readyForGovernedCrmWrites: planned.every(x => x.identityReady),
    crmWritesExecuted: writes.length,
    safety: {
      sendReplies: false,
      createCalendarEvents: false,
      mutateInstantlyCampaigns: false,
      automaticCrmWrites: false
    }
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'CRM_ROUTING');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_REPLY_TO_CRM_ROUTING.json');
  fs.writeFileSync(outputFile, JSON.stringify({ summary, writes }, null, 2));
  summary.outputFile = outputFile;

  return summary;
}

module.exports = { run, normalizeCandidate };
