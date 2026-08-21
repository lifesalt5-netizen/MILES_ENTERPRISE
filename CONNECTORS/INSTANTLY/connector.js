'use strict';

/*
  MILES Enterprise
  File: CONNECTORS/INSTANTLY/connector.js
  Version: 2.5.1

  Purpose:
  - ConnectorRuntime-compatible Instantly adapter.
  - Normalize runtime requests.
  - Expose authorized Instantly API v2 actions.
  - Preserve lead custom variables for trigger-personalized campaigns.
  - Enforce the global P2GC suppression registry before any lead creation/upload.
  - Expose read-only Unibox email retrieval for reply intelligence.
  - Expose guarded reply sending without bypassing existing mutation safety defaults.
  - Preserve execution truth: a dry-run or no-mutation result is never reported as a successful mutation.
*/

const path = require('path');
const instantly = require('./instantly');
const GlobalSuppressionService = require('../../SERVICES/revenue/GlobalSuppressionService');
const { INSTANTLY_ACTIONS, normalizeInstantlyAction } = require('../../CORE/ExecutionActionContracts');

function resolveAction(task = {}) {
  const requested = (
    task.connectorAction ||
    task.method ||
    task.operation ||
    task.action ||
    task.payload?.connectorAction ||
    task.payload?.method ||
    task.payload?.operation ||
    ''
  );

  return normalizeInstantlyAction(requested) || String(requested || '').trim();
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

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  return fallback;
}

function mutationTruth(action, result = {}) {
  if (!result || typeof result !== 'object') {
    return {
      ok: false,
      provider: 'Instantly',
      connector: 'INSTANTLY',
      action,
      status: 'MUTATION_RESULT_INVALID',
      mutationExecuted: false,
      dryRun: false,
      executionTruth: 'NO_EXTERNAL_MUTATION',
      error: 'Instantly mutation returned no execution evidence.'
    };
  }

  if (result.ok === false) {
    return {
      ...result,
      ok: false,
      provider: result.provider || 'Instantly',
      connector: 'INSTANTLY',
      action: result.action || action,
      mutationExecuted: result.mutationExecuted === true,
      dryRun: result.dryRun === true,
      executionTruth: result.mutationExecuted === true ? 'EXTERNAL_MUTATION_CONFIRMED' : 'NO_EXTERNAL_MUTATION',
      result
    };
  }

  const dryRun = result.dryRun === true || String(result.status || '').toUpperCase() === 'DRY_RUN';
  const explicitlyNoMutation = result.mutationExecuted === false;

  if (dryRun || explicitlyNoMutation) {
    return {
      ...result,
      ok: false,
      provider: result.provider || 'Instantly',
      connector: 'INSTANTLY',
      action: result.action || action,
      status: result.status || (dryRun ? 'DRY_RUN' : 'NO_MUTATION'),
      mutationExecuted: false,
      dryRun,
      executionTruth: 'NO_EXTERNAL_MUTATION',
      result
    };
  }

  return {
    ok: true,
    provider: result.provider || 'Instantly',
    connector: 'INSTANTLY',
    action: result.action || action,
    status: result.status || 'MUTATION_EXECUTED',
    mutationExecuted: true,
    dryRun: false,
    executionTruth: 'EXTERNAL_MUTATION_CONFIRMED',
    result
  };
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

async function guardedReplyToEmail(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, provider: 'Instantly', connector: 'INSTANTLY', mutationExecuted: false, error: 'Reply payload is required.' };
  }
  if (!payload.eaccount) {
    return { ok: false, provider: 'Instantly', connector: 'INSTANTLY', mutationExecuted: false, error: 'eaccount is required to send an Instantly reply.' };
  }
  if (!payload.reply_to_uuid) {
    return { ok: false, provider: 'Instantly', connector: 'INSTANTLY', mutationExecuted: false, error: 'reply_to_uuid is required to send an Instantly reply.' };
  }
  if (!payload.subject) {
    return { ok: false, provider: 'Instantly', connector: 'INSTANTLY', mutationExecuted: false, error: 'subject is required to send an Instantly reply.' };
  }
  const hasText = Boolean(payload.body && typeof payload.body.text === 'string' && payload.body.text.trim());
  const hasHtml = Boolean(payload.body && typeof payload.body.html === 'string' && payload.body.html.trim());
  if (!hasText && !hasHtml) {
    return { ok: false, provider: 'Instantly', connector: 'INSTANTLY', mutationExecuted: false, error: 'body.text or body.html is required to send an Instantly reply.' };
  }

  const dryRun = booleanEnv('MILES_DRY_RUN', true);
  const mutationsAllowed = booleanEnv('MILES_ALLOW_INSTANTLY_MUTATIONS', false);
  const controlledWrite = booleanEnv('MILES_CONTROLLED_WRITE_ENABLED', false);
  const instantlyWrite = booleanEnv('INSTANTLY_WRITE_ENABLED', false);
  const mayExecute = dryRun === false && mutationsAllowed && controlledWrite && instantlyWrite;

  if (!mayExecute) {
    return {
      ok: false,
      provider: 'Instantly',
      connector: 'INSTANTLY',
      action: 'replyToEmail',
      status: 'DRY_RUN',
      dryRun: true,
      mutationExecuted: false,
      executionTruth: 'NO_EXTERNAL_MUTATION',
      reason: 'Guarded reply sending requires all Instantly and MILES controlled-write gates.',
      requiredGates: {
        MILES_DRY_RUN: false,
        MILES_ALLOW_INSTANTLY_MUTATIONS: true,
        MILES_CONTROLLED_WRITE_ENABLED: true,
        INSTANTLY_WRITE_ENABLED: true
      },
      wouldExecute: {
        method: 'POST',
        endpoint: '/emails/reply',
        body: payload
      }
    };
  }

  const result = await instantly.request('/emails/reply', { method: 'POST', body: payload });
  return {
    ok: true,
    provider: 'Instantly',
    connector: 'INSTANTLY',
    action: 'replyToEmail',
    status: 'REPLY_SENT',
    dryRun: false,
    mutationExecuted: true,
    executionTruth: 'EXTERNAL_MUTATION_CONFIRMED',
    result
  };
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
        mutationExecuted: mutationExecuted > 0,
        executionTruth: mutationExecuted > 0 ? 'EXTERNAL_MUTATION_CONFIRMED' : 'NO_EXTERNAL_MUTATION',
        results,
        error: result.error || result.message || 'Instantly lead creation failed.'
      };
    }
  }

  const noExternalMutation = mutationExecuted === 0;
  const status =
    suppressed === leads.length
      ? 'ALL_LEADS_BLOCKED_GLOBAL_SUPPRESSION'
      : dryRun === leads.length - suppressed
        ? 'DRY_RUN'
        : 'LEADS_UPLOADED';

  return {
    ok: !noExternalMutation,
    provider: 'Instantly',
    connector: 'INSTANTLY',
    action: 'uploadLeads',
    status,
    campaignId,
    attempted: leads.length,
    uploaded: mutationExecuted,
    suppressed,
    dryRun,
    mutationExecuted: mutationExecuted > 0,
    executionTruth: noExternalMutation ? 'NO_EXTERNAL_MUTATION' : 'EXTERNAL_MUTATION_CONFIRMED',
    results
  };
}

module.exports = {
  id: 'INSTANTLY',
  name: 'Instantly Connector',
  version: '2.5.1',
  supportedActions: [...INSTANTLY_ACTIONS],
  canExecuteAction(action) {
    return Boolean(normalizeInstantlyAction(action));
  },

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
    'INSTANTLY_SEND_REPLY',
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

      case 'replyToEmail':
        return guardedReplyToEmail(payload);

      case 'createLead':
        return mutationTruth('createLead', await guardedCreateLead(payload));

      case 'uploadLeads':
        return await uploadLeads(payload);

      case 'createCampaign':
        return mutationTruth('createCampaign', await instantly.createCampaign(payload));

      case 'updateCampaign':
        return mutationTruth(
          'updateCampaign',
          await instantly.updateCampaign(
            resolveCampaignId(payload),
            payload.updates || payload.patch || payload.body || {}
          )
        );

      case 'pauseCampaign':
        return mutationTruth(
          'pauseCampaign',
          await instantly.pauseCampaign(
            resolveCampaignId(payload),
            payload.reason || context.reason || ''
          )
        );

      case 'activateCampaign':
      case 'resumeCampaign':
      case 'startCampaign':
        return mutationTruth('activateCampaign', await instantly.activateCampaign(resolveCampaignId(payload)));

      case 'deleteCampaign':
        return mutationTruth(
          'deleteCampaign',
          await instantly.deleteCampaign(
            resolveCampaignId(payload),
            payload.confirmation || ''
          )
        );

      default:
        return {
          ok: false,
          provider: 'Instantly',
          connector: 'INSTANTLY',
          error: `Unknown Instantly action: ${action}`,
          supportedActions: [...INSTANTLY_ACTIONS],
          received: task
        };
    }
  }
};