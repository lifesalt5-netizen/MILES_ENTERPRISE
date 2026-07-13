'use strict';

/*
  MILES Enterprise
  File: CONNECTORS/INSTANTLY/connector.js
  Version: 2.0.0

  Purpose:
  - ConnectorRuntime-compatible Instantly adapter.
  - Normalize runtime requests.
  - Expose authorized Instantly API v2 actions.
*/

const instantly =
  require('./instantly');

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
  return (
    task.payload ||
    task.input ||
    {}
  );
}

function resolveCampaignId(payload = {}) {
  return (
    payload.campaignId ||
    payload.campaign_id ||
    payload.id ||
    ''
  );
}

module.exports = {
  id:
    'INSTANTLY',

  name:
    'Instantly Connector',

  version:
    '2.0.0',

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
    'INSTANTLY_CREATE_CAMPAIGN',
    'INSTANTLY_UPDATE_CAMPAIGN',
    'INSTANTLY_PAUSE_CAMPAIGN',
    'INSTANTLY_ACTIVATE_CAMPAIGN',
    'INSTANTLY_DELETE_CAMPAIGN'
  ],

  async healthCheck() {
    return instantly.healthCheck();
  },

  async execute(
    task = {},
    context = {}
  ) {
    const action =
      resolveAction(task);

    const payload =
      resolvePayload(task);

    switch (action) {
      case 'health':
      case 'healthCheck':
        return instantly.healthCheck();

      case 'getConfiguration':
        return {
          ok: true,
          configuration:
            instantly.getConfiguration()
        };

      case 'listCampaigns':
        return {
          ok: true,
          campaigns:
            await instantly.listCampaigns(
              payload
            )
        };

      case 'getCampaign':
        return {
          ok: true,
          campaign:
            await instantly.getCampaign(
              resolveCampaignId(payload)
            )
        };

      case 'getCampaignAnalytics':
        return {
          ok: true,
          analytics:
            await instantly.getCampaignAnalytics(
              payload
            )
        };

      case 'getCampaignAnalyticsOverview':
        return {
          ok: true,
          analytics:
            await instantly.getCampaignAnalyticsOverview(
              payload
            )
        };

      case 'getCampaignDailyAnalytics':
        return {
          ok: true,
          analytics:
            await instantly.getCampaignDailyAnalytics(
              payload
            )
        };

      case 'getCampaignStepsAnalytics':
        return {
          ok: true,
          analytics:
            await instantly.getCampaignStepsAnalytics(
              payload
            )
        };

      case 'listAccounts':
        return {
          ok: true,
          accounts:
            await instantly.listAccounts(
              payload
            )
        };

      case 'testAccountVitals':
        return {
          ok: true,
          vitals:
            await instantly.testAccountVitals(
              payload.emails ||
              []
            )
        };

      case 'getWarmupAnalytics':
        return {
          ok: true,
          warmupAnalytics:
            await instantly.getWarmupAnalytics(
              payload
            )
        };

      case 'getDailyAccountAnalytics':
        return {
          ok: true,
          accountAnalytics:
            await instantly.getDailyAccountAnalytics(
              payload
            )
        };

      case 'listLeads':
        return {
          ok: true,
          leads:
            await instantly.listLeads(
              payload
            )
        };

      case 'createLead':
        return {
          ok: true,
          result:
            await instantly.createLead(
              payload
            )
        };

      case 'createCampaign':
        return {
          ok: true,
          result:
            await instantly.createCampaign(
              payload
            )
        };

      case 'updateCampaign':
        return {
          ok: true,
          result:
            await instantly.updateCampaign(
              resolveCampaignId(payload),
              payload.updates ||
              payload.patch ||
              payload.body ||
              {}
            )
        };

      case 'pauseCampaign':
        return {
          ok: true,
          result:
            await instantly.pauseCampaign(
              resolveCampaignId(payload),
              payload.reason ||
              context.reason ||
              ''
            )
        };

      case 'activateCampaign':
      case 'resumeCampaign':
      case 'startCampaign':
        return {
          ok: true,
          result:
            await instantly.activateCampaign(
              resolveCampaignId(payload)
            )
        };

      case 'deleteCampaign':
        return {
          ok: true,
          result:
            await instantly.deleteCampaign(
              resolveCampaignId(payload),
              payload.confirmation ||
              ''
            )
        };

      default:
        return {
          ok: false,
          provider:
            'Instantly',
          connector:
            'INSTANTLY',
          error:
            `Unknown Instantly action: ${action}`,
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
            'createLead',
            'createCampaign',
            'updateCampaign',
            'pauseCampaign',
            'activateCampaign',
            'resumeCampaign',
            'startCampaign',
            'deleteCampaign'
          ],
          received:
            task
        };
    }
  }
};