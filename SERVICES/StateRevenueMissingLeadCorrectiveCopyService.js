'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT = process.cwd();
const INPUT_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'MISSING_LEAD_CLASSIFICATION', 'STATE_REVENUE_MISSING_LEAD_WORKSPACE_CLASSIFICATION_LATEST.json');
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'CORRECTIVE_COPY');
const AUTH_TOKEN = 'AUTHORIZE_STATE_REVENUE_CORRECTIVE_COPY';
const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

function loadInput() {
  if (!fs.existsSync(INPUT_FILE)) throw new Error(`Missing classification artifact: ${INPUT_FILE}`);
  return JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
}

function eligibleStateRows(input) {
  return (input.states || []).filter(row => row.campaignId && Number(row.counts?.existsOtherCampaign || 0) > 0);
}

function sourceGroupsForState(row) {
  const groups = new Map();

  for (const item of (row.classifications || [])) {
    if (item.classification !== 'EXISTS_IN_OTHER_CAMPAIGN') continue;

    const email = String(item.email || '').trim().toLowerCase();
    const sourceCampaignIds = Array.isArray(item.otherCampaignIds)
      ? item.otherCampaignIds.filter(Boolean)
      : [];

    if (!email) continue;
    if (sourceCampaignIds.length !== 1) {
      throw new Error(`Expected exactly one source campaign for ${email}; found ${sourceCampaignIds.length}.`);
    }

    const sourceCampaignId = String(sourceCampaignIds[0]).trim();
    if (!sourceCampaignId) throw new Error(`Missing source campaign for ${email}.`);
    if (sourceCampaignId === row.campaignId) {
      throw new Error(`Source and target campaign are identical for ${email}; refusing corrective copy.`);
    }

    if (!groups.has(sourceCampaignId)) groups.set(sourceCampaignId, []);
    groups.get(sourceCampaignId).push(email);
  }

  return Array.from(groups.entries()).map(([sourceCampaignId, contacts]) => ({
    sourceCampaignId,
    contacts: Array.from(new Set(contacts))
  }));
}

async function postMove(payload) {
  const apiKey = process.env.INSTANTLY_API_KEY || '';
  if (!apiKey) throw new Error('INSTANTLY_API_KEY is not configured.');

  try {
    const response = await axios({
      method: 'POST',
      url: `${BASE_URL}/leads/move`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      data: payload,
      timeout: 30000,
      validateStatus: status => status >= 200 && status < 300
    });
    return { ok: true, data: response.data };
  } catch (error) {
    const statusCode = Number(error?.response?.status || 0);
    const detail = error?.response?.data || error?.message || error;
    const message = String(detail?.message || detail || '');

    if (statusCode === 409 && /move-leads job in progress/i.test(message)) {
      return {
        ok: false,
        busy: true,
        statusCode,
        detail
      };
    }

    throw new Error(`Instantly corrective copy failed: ${JSON.stringify(detail)}`);
  }
}

async function run(options = {}) {
  const authorization = String(options.authorization || process.env.MILES_STATE_REVENUE_CORRECTIVE_COPY_AUTH || '').trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_STATE_REVENUE_CORRECTIVE_COPY_LIVE || '').toLowerCase() === 'true';

  if (authorization !== AUTH_TOKEN) throw new Error('Corrective copy authorization token missing or incorrect.');
  if (!executeLive) throw new Error('Corrective copy live flag is not enabled.');

  const input = loadInput();
  if (Number(input.totals?.notFoundInWorkspace || 0) !== 0 || Number(input.totals?.workspaceUnassigned || 0) !== 0) {
    throw new Error('Classification contains non-other-campaign cases; refusing broad corrective mutation.');
  }

  const jobs = [];
  const busyGroups = [];

  for (const row of eligibleStateRows(input)) {
    const groups = sourceGroupsForState(row);

    for (const group of groups) {
      if (!group.contacts.length) continue;

      const payload = {
        campaign: group.sourceCampaignId,
        contacts: group.contacts,
        to_campaign_id: row.campaignId,
        copy_leads: true,
        check_duplicates: true,
        check_duplicates_in_campaigns: true,
        skip_leads_in_verification: true,
        reset_interest_status: false,
        limit: group.contacts.length
      };

      const moveResult = await postMove(payload);

      if (moveResult.busy) {
        busyGroups.push({
          state: row.state,
          sourceCampaignId: group.sourceCampaignId,
          targetCampaignId: row.campaignId,
          contactsDeferred: group.contacts.length,
          reason: 'MOVE_JOB_IN_PROGRESS'
        });
        continue;
      }

      const job = moveResult.data;
      if (!job?.id) throw new Error(`Instantly did not return a background job id for ${row.state} from ${group.sourceCampaignId}.`);

      jobs.push({
        state: row.state,
        sourceCampaignId: group.sourceCampaignId,
        targetCampaignId: row.campaignId,
        contactsRequested: group.contacts.length,
        backgroundJobId: job.id,
        status: job.status || null,
        type: job.type || null
      });
    }
  }

  const result = {
    ok: true,
    gate: 'P1.4C4_STATE_REVENUE_MISSING_LEAD_CORRECTIVE_COPY',
    generatedAt: new Date().toISOString(),
    totalContactsRequested: jobs.reduce((n, x) => n + x.contactsRequested, 0),
    totalContactsDeferredBusy: busyGroups.reduce((n, x) => n + x.contactsDeferred, 0),
    jobsSubmitted: jobs.length,
    busyGroupsCount: busyGroups.length,
    jobs,
    busyGroups,
    readyForReconciliation: jobs.length > 0 || busyGroups.length > 0,
    safety: {
      copyOnly: true,
      sourceCampaignRequired: true,
      removeFromExistingCampaigns: false,
      createNewLeads: false,
      deleteLeads: false,
      pauseCampaigns: false,
      activateCampaigns: false,
      sendReplies: false
    }
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  result.outputFile = path.join(OUTPUT_DIR, 'STATE_REVENUE_MISSING_LEAD_CORRECTIVE_COPY_LATEST.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run, eligibleStateRows, sourceGroupsForState };
