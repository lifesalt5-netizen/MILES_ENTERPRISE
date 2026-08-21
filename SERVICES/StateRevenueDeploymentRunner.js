'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { campaignSchedule } = require('./revenue/OutboundSendingGovernance');

const ROOT = process.cwd();
const STATES = ['FL', 'TX', 'CA', 'VA', 'MD'];
const AUTH_TOKEN = 'AUTHORIZE_STATE_REVENUE_DEPLOYMENT';

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.campaigns)) return value.campaigns;
  if (Array.isArray(value?.accounts)) return value.accounts;
  return [];
}

function selectHealthySenders(accounts) {
  return unwrapItems(accounts)
    .filter(account => {
      const status = Number(account.status);
      const setupPending = account.setup_pending === true;
      const scoreRaw = account.stat_warmup_score;
      const score = scoreRaw === undefined || scoreRaw === null || scoreRaw === '' ? null : Number(scoreRaw);
      if (!account.email || status !== 1 || setupPending) return false;
      if (score !== null && Number.isFinite(score) && score < 70) return false;
      return true;
    })
    .sort((a, b) => Number(b.stat_warmup_score || 0) - Number(a.stat_warmup_score || 0));
}

function sequenceForState(state) {
  const label = state;
  return [
    {
      type: 'email', delay: 2, delay_unit: 'days', variants: [{
        subject: `${label} government contracting`,
        body: `Hi,\n\nWe help businesses turn government registrations and capabilities into a practical sales plan — target agencies, opportunities, vehicles, and capture steps.\n\nWe're expanding our ${label} state/local program and identified your company as a possible fit. Would a 15-minute review of where you may have realistic public-sector opportunities be useful?\n\nKevin\nPathways 2 Government Contracting`,
        v_disabled: false
      }]
    },
    {
      type: 'email', delay: 3, delay_unit: 'days', variants: [{
        subject: `Re: ${label} government contracting`,
        body: `Following up in case ${label} state/local contracting is on your growth list. We can quickly show which agencies and opportunity types line up with your capabilities and where the gaps are. Worth a short conversation?`,
        v_disabled: false
      }]
    },
    {
      type: 'email', delay: 4, delay_unit: 'days', variants: [{
        subject: `Worth mapping the ${label} market?`,
        body: 'Many firms are registered but still do not have a clear agency and opportunity path. Our work is focused on turning that into an actionable pursuit plan. Open to a quick review?',
        v_disabled: false
      }]
    },
    {
      type: 'email', delay: 7, delay_unit: 'days', variants: [{
        subject: 'Close the loop?',
        body: `I'll close the loop for now. If ${label} state/local government growth becomes a priority, reply ${label} and I'll send a few times to talk.`,
        v_disabled: false
      }]
    }
  ];
}

function campaignPayload(state, senderEmails) {
  return {
    name: `STATE SLED - ${state}`,
    sequences: [{ steps: sequenceForState(state) }],
    email_list: senderEmails,
    campaign_schedule: campaignSchedule(),
    daily_limit: Math.min(25, Math.max(1, senderEmails.length) * 25),
    daily_max_leads: Math.min(25, Math.max(1, senderEmails.length) * 25),
    email_gap: 10,
    random_wait_max: 5,
    text_only: true,
    first_email_text_only: true,
    stop_on_reply: true,
    stop_for_company: true,
    link_tracking: false,
    open_tracking: false,
    insert_unsubscribe_header: true,
    allow_risky_contacts: false,
    disable_bounce_protect: false,
    prioritize_new_leads: true
  };
}

function leadPayload(row, campaignId, state) {
  const email = first(row, ['discoveredEmail', 'email', 'Email']).toLowerCase();
  const legalName = first(row, ['legalName', 'Legal_Name', 'legal_name', 'company_name']);
  const domain = first(row, ['domain', 'Domain', 'website', 'Website']);
  const uei = first(row, ['uei', 'UEI']);
  return {
    campaign: campaignId,
    email,
    company_name: legalName || undefined,
    website: domain ? (/^https?:\/\//i.test(domain) ? domain : `https://${domain}`) : undefined,
    custom_variables: uei ? { uei, source_segment: `STATE_SLED_${state}` } : { source_segment: `STATE_SLED_${state}` },
    skip_if_in_workspace: true,
    skip_if_in_campaign: true,
    verify_leads_on_import: true
  };
}

function resolveCampaignObject(createResponse) {
  const candidates = [
    createResponse?.result,
    createResponse?.campaign,
    createResponse?.data,
    createResponse?.result?.campaign,
    createResponse?.result?.data
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate?.id || candidate?.campaign_id) return candidate;
  }

  return null;
}

function loadLiveInstantlyConnector() {
  process.env.MILES_DRY_RUN = 'false';
  process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'true';

  const instantlyPath = require.resolve('../CONNECTORS/INSTANTLY/instantly');
  const connectorPath = require.resolve('../CONNECTORS/INSTANTLY/connector');
  delete require.cache[connectorPath];
  delete require.cache[instantlyPath];

  return require('../CONNECTORS/INSTANTLY/connector');
}

async function run(options = {}) {
  const authorization = String(options.authorization || process.env.MILES_STATE_REVENUE_DEPLOYMENT_AUTH || '').trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_STATE_REVENUE_DEPLOYMENT_LIVE || '').toLowerCase() === 'true';
  const activate = options.activate === true || String(process.env.MILES_STATE_REVENUE_ACTIVATE || '').toLowerCase() === 'true';

  if (authorization !== AUTH_TOKEN) throw new Error('State revenue deployment authorization token missing or incorrect.');
  if (!executeLive) throw new Error('State revenue deployment live flag is not enabled.');

  const reconciliation = require('./StateSledVerifiedMasterReconciliationService');
  const masterResult = await reconciliation.run();
  const masterFile = masterResult.outputs.masterFile;
  const allRows = await readCsv(masterFile);

  const byState = new Map(STATES.map(state => [state, new Map()]));
  for (const row of allRows) {
    const state = first(row, ['state', 'State', 'NORMALIZED_STATE']).toUpperCase();
    const email = first(row, ['discoveredEmail', 'email', 'Email']).toLowerCase();
    if (!byState.has(state) || !email) continue;
    if (!byState.get(state).has(email)) byState.get(state).set(email, row);
  }

  const connector = loadLiveInstantlyConnector();
  const configuration = await connector.execute({ action: 'getConfiguration', payload: {} });
  if (configuration?.configuration?.liveMutationsEnabled !== true) {
    throw new Error(`Instantly live mutations are not enabled after guarded reload: ${JSON.stringify(configuration)}`);
  }

  const campaignInventory = await connector.execute({ action: 'listCampaigns', payload: { limit: 100 } });
  const campaigns = unwrapItems(campaignInventory?.campaigns);
  const accountInventory = await connector.execute({ action: 'listAccounts', payload: { limit: 100 } });
  const healthy = selectHealthySenders(accountInventory?.accounts);
  if (!healthy.length) throw new Error('No healthy Instantly sending accounts available.');

  const senderEmails = [healthy[0].email];
  const summaries = [];

  for (const state of STATES) {
    const leads = [...byState.get(state).values()];
    const name = `STATE SLED - ${state}`;
    let campaign = campaigns.find(c => String(c.name || '').trim().toUpperCase() === name.toUpperCase()) || null;
    let campaignCreated = false;

    if (!leads.length) {
      summaries.push({ state, campaignName: name, verifiedLeads: 0, status: 'NO_VERIFIED_LEADS' });
      continue;
    }

    if (!campaign) {
      let created;
      try {
        created = await connector.execute({ action: 'createCampaign', payload: campaignPayload(state, senderEmails) });
      } catch (error) {
        throw new Error(`Campaign creation request failed for ${state}: ${error.message}`);
      }

      campaign = resolveCampaignObject(created);
      if (!campaign) {
        const raw = JSON.stringify(created).slice(0, 2000);
        throw new Error(`Campaign creation failed for ${state}; response=${raw}`);
      }
      campaigns.push(campaign);
      campaignCreated = true;
    }

    const campaignId = campaign.id || campaign.campaign_id;
    let uploaded = 0;
    let failed = 0;
    for (const row of leads) {
      try {
        const result = await connector.execute({ action: 'createLead', payload: leadPayload(row, campaignId, state) });
        const mutation = result?.result || result;
        const dryRun = mutation?.dryRun === true;
        const mutationExecuted = mutation?.mutationExecuted;
        if (result?.ok === false || dryRun || mutationExecuted === false) failed += 1;
        else uploaded += 1;
      } catch {
        failed += 1;
      }
    }

    let activatedNow = false;
    if (activate) {
      const live = await connector.execute({ action: 'getCampaign', payload: { campaign_id: campaignId } });
      const status = Number(live?.campaign?.status ?? live?.result?.status ?? campaign?.status);
      if (status !== 1) {
        const activated = await connector.execute({ action: 'activateCampaign', payload: { campaign_id: campaignId } });
        const mutation = activated?.result || activated;
        if (mutation?.dryRun === true || mutation?.mutationExecuted === false) {
          throw new Error(`Activation did not execute for ${state}: ${JSON.stringify(activated)}`);
        }
        activatedNow = true;
      }
    }

    summaries.push({
      state,
      campaignName: name,
      campaignId,
      campaignCreated,
      senderEmails,
      verifiedLeads: leads.length,
      uploadSucceeded: uploaded,
      uploadFailed: failed,
      activationRequested: activate,
      activatedNow
    });
  }

  const summary = {
    ok: summaries.every(x => (x.uploadFailed || 0) === 0),
    gate: 'P1.4B_VERIFIED_STATE_REVENUE_DEPLOYMENT',
    generatedAt: new Date().toISOString(),
    verifiedMasterUnique: allRows.length,
    senderEmails,
    states: summaries,
    totals: {
      verifiedLeads: summaries.reduce((n, x) => n + Number(x.verifiedLeads || 0), 0),
      uploaded: summaries.reduce((n, x) => n + Number(x.uploadSucceeded || 0), 0),
      failed: summaries.reduce((n, x) => n + Number(x.uploadFailed || 0), 0),
      campaignsCreated: summaries.filter(x => x.campaignCreated).length,
      campaignsActivated: summaries.filter(x => x.activatedNow).length
    }
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'DEPLOYMENT');
  fs.mkdirSync(outDir, { recursive:true });
  summary.outputFile = path.join(outDir, 'STATE_REVENUE_DEPLOYMENT_LATEST.json');
  fs.writeFileSync(summary.outputFile, JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = { run, selectHealthySenders, campaignPayload, leadPayload, sequenceForState, resolveCampaignObject, loadLiveInstantlyConnector };
