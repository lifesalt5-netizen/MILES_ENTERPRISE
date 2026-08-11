'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RECON_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'LEAD_RECONCILIATION', 'STATE_REVENUE_LEAD_RECONCILIATION_LATEST.json');
const OUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'MISSING_LEAD_CLASSIFICATION');

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function loadReconciliation() {
  if (!fs.existsSync(RECON_FILE)) throw new Error(`Reconciliation artifact not found: ${RECON_FILE}`);
  return JSON.parse(fs.readFileSync(RECON_FILE, 'utf8'));
}

async function run() {
  const recon = loadReconciliation();
  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const states = [];

  for (const stateRow of recon.states || []) {
    const missingEmails = Array.isArray(stateRow.missingEmails) ? stateRow.missingEmails.map(normalizeEmail).filter(Boolean) : [];
    if (!missingEmails.length || !stateRow.campaignId) {
      states.push({
        state: stateRow.state,
        campaignId: stateRow.campaignId || null,
        missing: missingEmails.length,
        classifications: [],
        counts: { alreadyInTargetCampaign: 0, existsOtherCampaign: 0, workspaceUnassigned: 0, notFoundInWorkspace: 0 }
      });
      continue;
    }

    const result = await connector.execute({
      action: 'listLeads',
      payload: {
        contacts: missingEmails,
        limit: 100,
        distinct_contacts: false
      }
    });

    const items = unwrapItems(result?.leads || result?.result || []);
    const byEmail = new Map();
    for (const item of items) {
      const email = normalizeEmail(item?.email || item?.contact);
      if (!email) continue;
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(item);
    }

    const classifications = [];
    for (const email of missingEmails) {
      const matches = byEmail.get(email) || [];
      const targetMatches = matches.filter(x => String(x?.campaign || x?.campaign_id || '') === String(stateRow.campaignId));
      const otherCampaigns = [...new Set(matches.map(x => String(x?.campaign || x?.campaign_id || '')).filter(Boolean).filter(id => id !== String(stateRow.campaignId)))];

      let classification;
      if (targetMatches.length) classification = 'ALREADY_IN_TARGET_CAMPAIGN';
      else if (otherCampaigns.length) classification = 'EXISTS_IN_OTHER_CAMPAIGN';
      else if (matches.length) classification = 'EXISTS_IN_WORKSPACE_UNASSIGNED';
      else classification = 'NOT_FOUND_IN_WORKSPACE';

      classifications.push({
        email,
        classification,
        targetCampaignId: stateRow.campaignId,
        matchedLeadObjects: matches.length,
        otherCampaignIds: otherCampaigns
      });
    }

    const counts = {
      alreadyInTargetCampaign: classifications.filter(x => x.classification === 'ALREADY_IN_TARGET_CAMPAIGN').length,
      existsOtherCampaign: classifications.filter(x => x.classification === 'EXISTS_IN_OTHER_CAMPAIGN').length,
      workspaceUnassigned: classifications.filter(x => x.classification === 'EXISTS_IN_WORKSPACE_UNASSIGNED').length,
      notFoundInWorkspace: classifications.filter(x => x.classification === 'NOT_FOUND_IN_WORKSPACE').length
    };

    states.push({
      state: stateRow.state,
      campaignId: stateRow.campaignId,
      missing: missingEmails.length,
      classifications,
      counts,
      recommendedNextAction:
        counts.existsOtherCampaign > 0 || counts.workspaceUnassigned > 0
          ? 'USE_MOVE_OR_ADD_EXISTING_LEADS_TO_TARGET_CAMPAIGN'
          : counts.notFoundInWorkspace > 0
            ? 'CREATE_ONLY_TRULY_ABSENT_LEADS'
            : 'NO_CORRECTIVE_ACTION_REQUIRED'
    });
  }

  const result = {
    ok: true,
    gate: 'P1.4C3_STATE_REVENUE_MISSING_LEAD_WORKSPACE_CLASSIFICATION',
    generatedAt: new Date().toISOString(),
    states,
    totals: {
      missing: states.reduce((n, x) => n + Number(x.missing || 0), 0),
      alreadyInTargetCampaign: states.reduce((n, x) => n + Number(x.counts?.alreadyInTargetCampaign || 0), 0),
      existsOtherCampaign: states.reduce((n, x) => n + Number(x.counts?.existsOtherCampaign || 0), 0),
      workspaceUnassigned: states.reduce((n, x) => n + Number(x.counts?.workspaceUnassigned || 0), 0),
      notFoundInWorkspace: states.reduce((n, x) => n + Number(x.counts?.notFoundInWorkspace || 0), 0)
    },
    safety: {
      readOnly: true,
      createLeads: false,
      moveLeads: false,
      addLeads: false,
      activateCampaigns: false,
      pauseCampaigns: false,
      deleteCampaigns: false
    }
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  result.outputFile = path.join(OUT_DIR, 'STATE_REVENUE_MISSING_LEAD_WORKSPACE_CLASSIFICATION_LATEST.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run, unwrapItems, normalizeEmail };
