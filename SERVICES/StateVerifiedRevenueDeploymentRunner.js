'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const ROOT = process.cwd();
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'CONFIG', 'state_verified_revenue_deployment_rules.json'), 'utf8'));
const TEMPLATE = JSON.parse(fs.readFileSync(path.join(ROOT, RULES.campaignTemplateRulesFile), 'utf8'));

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file).pipe(csv()).on('data', r => rows.push(r)).on('end', () => resolve(rows)).on('error', reject);
  });
}

function first(row, keys) {
  for (const key of keys) {
    const v = row?.[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function unwrap(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function healthyAccounts(payload) {
  return unwrap(payload).filter(a => {
    const status = Number(a.status);
    const warmupStatus = Number(a.warmup_status);
    const scoreRaw = a.stat_warmup_score;
    const score = scoreRaw === undefined || scoreRaw === null || scoreRaw === '' ? null : Number(scoreRaw);
    if (!a.email || status !== 1 || a.setup_pending === true || warmupStatus < 0) return false;
    if (score !== null && Number.isFinite(score) && score < Number(RULES.minimumWarmupScore || 70)) return false;
    return true;
  }).sort((a, b) => Number(b.stat_warmup_score || 0) - Number(a.stat_warmup_score || 0));
}

function stateSequence(state) {
  const full = RULES.stateNames[state] || state;
  return TEMPLATE.sequence.steps.map(step => ({
    ...step,
    variants: (step.variants || []).map(v => ({
      ...v,
      subject: String(v.subject || '').replace(/Florida/g, full),
      body: String(v.body || '').replace(/Florida/g, full).replace(/reply Florida/g, `reply ${full}`)
    }))
  }));
}

function campaignPayload(state, sender, dailyLimit) {
  return {
    name: `STATE SLED - ${state}`,
    sequences: [{ steps: stateSequence(state) }],
    email_list: [sender],
    ...TEMPLATE.campaign,
    daily_limit: dailyLimit,
    daily_max_leads: dailyLimit
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
    custom_variables: { ...(uei ? { uei } : {}), source_segment: `STATE_SLED_${state}` },
    skip_if_in_workspace: true,
    skip_if_in_campaign: true
  };
}

function authorized(options = {}) {
  const token = String(options.authorization || process.env[RULES.authorizationEnv] || '');
  const live = options.executeLive === true || String(process.env[RULES.executeLiveEnv] || '').toLowerCase() === 'true';
  return token === RULES.authorizationToken && live;
}

async function run(options = {}) {
  if (!authorized(options)) throw new Error('P1.4B live deployment authorization is missing or incorrect.');

  const verifiedFile = path.join(ROOT, RULES.verifiedMasterFile);
  if (!fs.existsSync(verifiedFile)) throw new Error(`Verified master not found: ${verifiedFile}`);

  const rows = await readCsv(verifiedFile);
  const byState = {};
  for (const state of RULES.states) byState[state] = new Map();
  for (const row of rows) {
    const state = first(row, ['state', 'State', 'NORMALIZED_STATE']).toUpperCase();
    const email = first(row, ['discoveredEmail', 'email', 'Email']).toLowerCase();
    if (!byState[state] || !email) continue;
    if (String(first(row, ['verificationDisposition'])).toUpperCase() && String(first(row, ['verificationDisposition'])).toUpperCase() !== 'VERIFIED_OK') continue;
    if (!byState[state].has(email)) byState[state].set(email, row);
  }

  const deployableStates = RULES.states.filter(s => byState[s].size >= Number(RULES.minimumVerifiedLeads || 25));
  if (!deployableStates.length) throw new Error('No state has enough verified leads to deploy.');

  process.env.MILES_DRY_RUN = 'false';
  process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'true';
  const connector = require('../CONNECTORS/INSTANTLY/connector');

  const accountResult = await connector.execute({ action: 'listAccounts', payload: { limit: 100 } });
  const accounts = healthyAccounts(accountResult?.accounts);
  if (!accounts.length) throw new Error('No healthy Instantly sender accounts are available.');

  const assignment = {};
  deployableStates.forEach((state, i) => { assignment[state] = accounts[i % accounts.length].email; });
  const loadPerSender = {};
  Object.values(assignment).forEach(email => { loadPerSender[email] = (loadPerSender[email] || 0) + 1; });
  const dailyPerSenderCampaign = {};
  for (const [email, count] of Object.entries(loadPerSender)) {
    dailyPerSenderCampaign[email] = Math.max(1, Math.floor(Number(RULES.maximumDailyPerInboxAcrossStateCampaigns || 25) / count));
  }

  const inventoryResult = await connector.execute({ action: 'listCampaigns', payload: { limit: 100 } });
  const inventory = unwrap(inventoryResult?.campaigns);
  const results = [];

  for (const state of deployableStates) {
    const name = `STATE SLED - ${state}`;
    const sender = assignment[state];
    const dailyLimit = dailyPerSenderCampaign[sender];
    let campaign = inventory.find(c => String(c.name || '').trim().toUpperCase() === name.toUpperCase()) || null;
    let campaignCreated = false;

    if (!campaign) {
      const created = await connector.execute({ action: 'createCampaign', payload: campaignPayload(state, sender, dailyLimit) });
      campaign = created?.result || created?.campaign || null;
      if (!campaign?.id) throw new Error(`Campaign creation failed for ${state}: ${JSON.stringify(created).slice(0, 800)}`);
      campaignCreated = true;
    } else {
      await connector.execute({
        action: 'updateCampaign',
        payload: {
          campaign_id: campaign.id,
          updates: {
            email_list: [sender],
            daily_limit: dailyLimit,
            daily_max_leads: dailyLimit,
            stop_on_reply: true,
            link_tracking: false,
            open_tracking: false,
            allow_risky_contacts: false
          }
        }
      });
    }

    const leads = [...byState[state].values()];
    let uploaded = 0;
    let failed = 0;
    const failures = [];
    for (const row of leads) {
      const payload = leadPayload(row, campaign.id, state);
      try {
        const r = await connector.execute({ action: 'createLead', payload });
        if (r?.ok === false) { failed += 1; failures.push({ email: payload.email, error: r.error || 'createLead failed' }); }
        else uploaded += 1;
      } catch (error) {
        failed += 1;
        failures.push({ email: payload.email, error: error.message });
      }
    }

    let activatedNow = false;
    let final = await connector.execute({ action: 'getCampaign', payload: { campaign_id: campaign.id } });
    let finalCampaign = final?.campaign || final?.result || campaign;
    if (failed === 0 && Number(finalCampaign?.status) !== 1) {
      await connector.execute({ action: 'activateCampaign', payload: { campaign_id: campaign.id } });
      activatedNow = true;
      final = await connector.execute({ action: 'getCampaign', payload: { campaign_id: campaign.id } });
      finalCampaign = final?.campaign || final?.result || {};
    }

    results.push({
      state,
      campaignName: name,
      campaignId: campaign.id,
      campaignCreated,
      sender,
      dailyLimit,
      verifiedLeads: leads.length,
      uploadSucceeded: uploaded,
      uploadFailed: failed,
      activatedNow,
      finalCampaignStatus: finalCampaign?.status ?? null,
      failures: failures.slice(0, 25)
    });
  }

  const summary = {
    ok: results.every(r => r.uploadFailed === 0 && Number(r.finalCampaignStatus) === 1),
    gate: RULES.gate,
    version: RULES.version,
    generatedAt: new Date().toISOString(),
    verifiedMasterRows: rows.length,
    deployableStates,
    healthySenderCount: accounts.length,
    senderAssignments: assignment,
    perSenderCampaignDailyLimit: dailyPerSenderCampaign,
    states: results,
    totals: {
      verifiedLeads: results.reduce((n, r) => n + r.verifiedLeads, 0),
      uploadSucceeded: results.reduce((n, r) => n + r.uploadSucceeded, 0),
      uploadFailed: results.reduce((n, r) => n + r.uploadFailed, 0),
      activeCampaigns: results.filter(r => Number(r.finalCampaignStatus) === 1).length
    },
    safety: RULES.safety
  };

  const outDir = path.join(ROOT, RULES.outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_VERIFIED_REVENUE_DEPLOYMENT_LATEST.json');
  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  summary.outputFile = outputFile;
  return summary;
}

module.exports = { run, authorized, healthyAccounts, stateSequence, campaignPayload, leadPayload };
