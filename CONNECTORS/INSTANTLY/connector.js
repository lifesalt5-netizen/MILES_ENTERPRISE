'use strict';

/*
  MILES Enterprise
  File: CONNECTORS/INSTANTLY/connector.js
  Version: 2.2.0

  Purpose:
  - ConnectorRuntime-compatible Instantly adapter.
  - Normalize runtime requests.
  - Expose authorized Instantly API v2 actions.
  - Preserve lead custom variables for trigger-personalized campaigns.
  - Enforce the global P2GC suppression registry before any lead creation/upload.
  - Expose read-only Unibox email retrieval for reply intelligence.
*/

const path = require('path');
const instantly = require('./instantly');
const GlobalSuppressionService = require('../../SERVICES/revenue/GlobalSuppressionService');

function resolveAction(task = {}) {
  return (
    task.connectorAction ||
    task.method ||
    task.operation ||
    task.action ||
    task.payload?.connectorAction ||
    task.payload?.method ||
    task.payload?.operation ||
    ''
  );
}

function resolvePayload(task = {}) {
  return task.payload || task.input || {};
}

function resolveCampaignId(payload = {}) {
  return payload.campaignId || payload.campaign_id || payload.id || '';
}

function rootDir() {
  return path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
}

function suppressionService() {
  return new GlobalSuppressionService({ rootDir: rootDir() });
}

function leadEmail(payload = {}) {
  return String(payload.email || payload.contact || '').trim().toLowerCase();
}

async function guardedCreateLead(payload = {}) {
  const email = leadEmail(payload);
  const suppression = email ? suppressionService().get(email) : null;
  if (suppression) {
    return {
      ok: true,
      provider: 'Instantly',
      connector: 'INSTANTLY',
      status: 'LEAD_BLOCKED_GLOBAL_SUPPRESSION',
      mutationExecuted: false,
      globallySuppressed: true,
      email,
      suppression
    };
  }
  return instantly.createLead(payload);
}

async function uploadLeads(payload = {}) {
  const campaignId = resolveCampaignId(payload);
  const leads = Array.isArray(payload.leads) ? payload.leads : [];

  if (!campaignId) {
    return { ok: false, provider: 'Instantly', connector: 'INSTANTLY', error: 'campaignId is required for uploadLeads.' };
  }

  if (leads.length === 0) {
    return { ok: false, provider: 'Instantly', connector: 'INSTANTLY', error: 'leads must be a non-empty array for uploadLeads.' };
  }

  const results = [];
  let mutationExecuted = 0;
  let dryRun = 0;
  let suppressed = 0;

  for (const lead of leads) {
    const leadPayload = {
      ...lead,
      campaign: lead.campaign || lead.campaign_id || campaignId,
      custom_variables: lead.custom_variables || lead.customVariables || {}
    };

    delete leadPayload.campaign_id;
    delete leadPayload.customVariables;

    const result = await guardedCreateLead(leadPayload);
    results.push(result);

    if (result?.globallySuppressed === true) {
      suppressed += 1;
      continue;
    }
    if (result?.dryRun === true) dryRun += 1;
    if (result?.mutationExecuted === true || (result && result.id)) mutationExecuted += 1;
    if (result?.ok === false && result?.dryRun !== true) {
      return {
        ok: false,
        provider: 'Instantly',
        connector: 'INSTANTLY',
        status: 'LEAD_UPLOAD_FAILED',
        campaignId,
        attempted: results.length,
        uploaded: mutationExecuted,
        suppressed,
        dryRun,
        results,
        error: result.error || result.message || 'Instantly lead creation failed.'
      };
    }
  }

  return {
    ok: true,
    provider: 'Instantly',
    connector: 'INSTANTLY',
    status:
      suppressed === leads.length
        ? 'ALL_LEADS_BLOCKED_GLOBAL_SUPPRESSION'
        : dryRun === leads.length - suppressed
          ? 'DRY_RUN'
          : 'LEADS_UPLOADED',
    campaignId,
    attempted: leads.length,
    uploaded: mutationExecuted,
    suppressed,
    dryRun,
    results
  };
}

module.exports = {
  id: 'INSTANTLY',
  name: 'Instantly Connector',
  version: '2.2.0',

  capabilities: [
    'INSTANTLY_HEALTH',
    'INSTANTLY_CONFIGURATION',
    'INSTANTLY_LIST_CAMPAIGNS',
    'INSTANTLY_GET_CAMPAIGN',
    'INSTANTLY_CAMPAIGN_ANALYTICS',
    'INSTANTLY_ACCOUNT_INVENTORY',
    'INSTANTLY_ACCOUNT_VITALS',
    'INSTANTLY_WARMUP_ANALYTICS',
    'INSTANTLY_LIST_LEADS',
    'INSTANTLY_CREATE_LEAD',
    'INSTANTLY_UPLOAD_LEADS',
    'INSTANTLY_LIST_EMAILS',
    'INSTANTLY_GET_EMAIL',
    'INSTANTLY_CREATE_CAMPAIGN',
    'INSTANTLY_UPDATE_CAMPAIGN',
    'INSTANTLY_PAUSE_CAMPAIGN',
    'INSTANTLY_ACTIVATE_CAMPAIGN',
    'INSTANTLY_DELETE_CAMPAIGN'
  ],

  async healthCheck() {
    return instantly.healthCheck();
  },

  async execute(task = {}, context = {}) {
    const action = resolveAction(task);
    const payload = resolvePayload(task);

    switch (action) {
      case 'health':
      case 'healthCheck':
        return instantly.healthCheck();

      case 'getConfiguration':
        return { ok: true, configuration: instantly.getConfiguration() };

      case 'listCampaigns':
        return { ok: true, campaigns: await instantly.listCampaigns(payload) };

      case 'getCampaign':
        return { ok: true, campaign: await instantly.getCampaign(resolveCampaignId(payload)) };

      case 'getCampaignAnalytics':
        return { ok: true, analytics: await instantly.getCampaignAnalytics(payload) };

      case 'getCampaignAnalyticsOverview':
        return { ok: true, analytics: await instantly.getCampaignAnalyticsOverview(payload) };

      case 'getCampaignDailyAnalytics':
        return { ok: true, analytics: await instantly.getCampaignDailyAnalytics(payload) };

      case 'getCampaignStepsAnalytics':
        return { ok: true, analytics: await instantly.getCampaignStepsAnalytics(payload) };

      case 'listAccounts':
        return { ok: true, accounts: await instantly.listAccounts(payload) };

      case 'testAccountVitals':
        return { ok: true, vitals: await instantly.testAccountVitals(payload.emails || []) };

      case 'getWarmupAnalytics':
        return { ok: true, warmupAnalytics: await instantly.getWarmupAnalytics(payload) };

      case 'getDailyAccountAnalytics':
        return { ok: true, accountAnalytics: await instantly.getDailyAccountAnalytics(payload) };

      case 'listLeads':
        return { ok: true, leads: await instantly.listLeads(payload) };

      case 'listEmails':
        return {
          ok: true,
          emails: await instantly.request('/emails', { method: 'GET', params: payload })
        };

      case 'getEmail': {
        const emailId = payload.emailId || payload.email_id || payload.id || '';
        if (!emailId) return { ok: false, error: 'emailId is required for getEmail.' };
        return {
          ok: true,
          email: await instantly.request(`/emails/${encodeURIComponent(emailId)}`, { method: 'GET' })
        };
      }

      case 'createLead':
        return { ok: true, result: await guardedCreateLead(payload) };

      case 'uploadLeads':
        return await uploadLeads(payload);

      case 'createCampaign':
        return { ok: true, result: await instantly.createCampaign(payload) };

      case 'updateCampaign':
        return {
          ok: true,
          result: await instantly.updateCampaign(
            resolveCampaignId(payload),
            payload.updates || payload.patch || payload.body || {}
          )
        };

      case 'pauseCampaign':
        return {
          ok: true,
          result: await instantly.pauseCampaign(
            resolveCampaignId(payload),
            payload.reason || context.reason || ''
          )
        };

      case 'activateCampaign':
      case 'resumeCampaign':
      case 'startCampaign':
        return { ok: true, result: await instantly.activateCampaign(resolveCampaignId(payload)) };

      case 'deleteCampaign':
        return {
          ok: true,
          result: await instantly.deleteCampaign(
            resolveCampaignId(payload),
            payload.confirmation || ''
          )
        };

      default:
        return {
          ok: false,
          provider: 'Instantly',
          connector: 'INSTANTLY',
          error: `Unknown Instantly action: ${action}`,
          supportedActions: [
            'healthCheck',
            'getConfiguration',
            'listCampaigns',
            'getCampaign',
            'getCampaignAnalytics',
            'getCampaignAnalyticsOverview',
            'getCampaignDailyAnalytics',
            'getCampaignStepsAnalytics',
            'listAccounts',
            'testAccountVitals',
            'getWarmupAnalytics',
            'getDailyAccountAnalytics',
            'listLeads',
            'listEmails',
            'getEmail',
            'createLead',
            'uploadLeads',
            'createCampaign',
            'updateCampaign',
            'pauseCampaign',
            'activateCampaign',
            'resumeCampaign',
            'startCampaign',
            'deleteCampaign'
          ],
          received: task
        };
    }
  }
};
