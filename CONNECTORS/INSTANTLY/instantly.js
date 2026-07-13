'use strict';

/*
  MILES Enterprise
  File: CONNECTORS/INSTANTLY/instantly.js
  Version: 2.0.0

  Purpose:
  - Authoritative JavaScript Instantly API v2 client.
  - Read campaigns, accounts, analytics, leads, and account health.
  - Perform guarded campaign and lead mutations.
  - Default all mutations to dry-run unless explicitly authorized.

  Required:
  INSTANTLY_API_KEY=<Instantly API v2 key>

  Safety defaults:
  MILES_DRY_RUN=true
  MILES_ALLOW_INSTANTLY_MUTATIONS=false

  To permit live mutations:
  MILES_DRY_RUN=false
  MILES_ALLOW_INSTANTLY_MUTATIONS=true
*/

const axios = require('axios');
require('dotenv').config();

const BASE_URL =
  process.env.INSTANTLY_BASE_URL ||
  'https://api.instantly.ai/api/v2';

const API_KEY =
  process.env.INSTANTLY_API_KEY ||
  '';

const REQUEST_TIMEOUT_MS =
  positiveInteger(
    process.env.INSTANTLY_REQUEST_TIMEOUT_MS,
    30000
  );

const MAX_RETRIES =
  positiveInteger(
    process.env.INSTANTLY_MAX_RETRIES,
    2
  );

const DRY_RUN =
  parseBoolean(
    process.env.MILES_DRY_RUN,
    true
  );

const MUTATIONS_ALLOWED =
  parseBoolean(
    process.env.MILES_ALLOW_INSTANTLY_MUTATIONS,
    false
  );

const MUTATING_ACTIONS = new Set([
  'createCampaign',
  'updateCampaign',
  'deleteCampaign',
  'pauseCampaign',
  'activateCampaign',
  'createLead'
]);

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}

function parseBoolean(value, fallback = false) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      'true',
      '1',
      'yes',
      'y',
      'on'
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      'false',
      '0',
      'no',
      'n',
      'off'
    ].includes(normalized)
  ) {
    return false;
  }

  return fallback;
}

function sleep(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function requireApiKey() {
  if (!API_KEY) {
    throw new Error(
      'INSTANTLY_API_KEY is not configured.'
    );
  }
}

function normalizeError(error) {
  const status =
    error?.response?.status ||
    null;

  const responseData =
    error?.response?.data ||
    null;

  const responseText =
    typeof responseData === 'string'
      ? responseData
      : responseData
        ? JSON.stringify(responseData)
        : null;

  const message =
    responseText
      ? `Instantly API ${status || 'error'}: ${responseText.slice(0, 1000)}`
      : error?.message ||
        'Unknown Instantly API error.';

  const normalized =
    new Error(message);

  normalized.statusCode =
    status;

  normalized.response =
    responseData;

  normalized.code =
    error?.code ||
    null;

  return normalized;
}

function buildMutationResult(
  action,
  requestDetails
) {
  return {
    ok: true,
    dryRun: true,
    mutationExecuted: false,
    provider: 'Instantly',
    action,
    reason:
      DRY_RUN
        ? 'MILES_DRY_RUN is enabled.'
        : 'MILES_ALLOW_INSTANTLY_MUTATIONS is not enabled.',
    wouldExecute:
      requestDetails,
    generatedAt:
      new Date().toISOString()
  };
}

function mayExecuteMutation() {
  return (
    DRY_RUN === false &&
    MUTATIONS_ALLOWED === true
  );
}

async function request(
  endpoint,
  options = {}
) {
  requireApiKey();

  const method =
    String(
      options.method ||
      'GET'
    ).toUpperCase();

  const params =
    options.params ||
    undefined;

  const body =
    options.body ??
    undefined;

  const retries =
    Number.isFinite(options.retries)
      ? options.retries
      : MAX_RETRIES;

  let finalError = null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt += 1
  ) {
    try {
      const response =
        await axios({
          method,

          url:
            `${BASE_URL}${endpoint}`,

          headers: {
            Authorization:
              `Bearer ${API_KEY}`,

            'Content-Type':
              'application/json',

            Accept:
              'application/json'
          },

          params,

          data:
            body,

          timeout:
            REQUEST_TIMEOUT_MS,

          validateStatus:
            status =>
              status >= 200 &&
              status < 300
        });

      return response.data;
    } catch (error) {
      finalError =
        normalizeError(error);

      const retryable =
        error?.response?.status === 429 ||
        error?.response?.status >= 500 ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ECONNABORTED';

      if (
        attempt >= retries ||
        !retryable
      ) {
        throw finalError;
      }

      const retryAfterHeader =
        error?.response?.headers?.[
          'retry-after'
        ];

      const retryAfterMs =
        Number(retryAfterHeader) > 0
          ? Number(retryAfterHeader) * 1000
          : Math.pow(2, attempt) * 1000;

      await sleep(
        retryAfterMs
      );
    }
  }

  throw (
    finalError ||
    new Error(
      'Instantly request failed.'
    )
  );
}

async function healthCheck() {
  try {
    const campaignResponse =
      await listCampaigns({
        limit: 1
      });

    const accountResponse =
      await listAccounts({
        limit: 1
      });

    return {
      ok: true,
      provider:
        'Instantly',
      apiVersion:
        'v2',
      campaignsReachable:
        true,
      accountsReachable:
        true,
      campaignResponseType:
        Array.isArray(campaignResponse)
          ? 'array'
          : typeof campaignResponse,
      accountResponseType:
        Array.isArray(accountResponse)
          ? 'array'
          : typeof accountResponse,
      dryRun:
        DRY_RUN,
      mutationsAllowed:
        MUTATIONS_ALLOWED,
      generatedAt:
        new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      provider:
        'Instantly',
      apiVersion:
        'v2',
      error:
        error.message,
      statusCode:
        error.statusCode ||
        null,
      dryRun:
        DRY_RUN,
      mutationsAllowed:
        MUTATIONS_ALLOWED,
      generatedAt:
        new Date().toISOString()
    };
  }
}

async function listCampaigns(params = {}) {
  return request(
    '/campaigns',
    {
      method:
        'GET',
      params
    }
  );
}

async function getCampaign(campaignId) {
  if (!campaignId) {
    throw new Error(
      'campaignId is required.'
    );
  }

  return request(
    `/campaigns/${encodeURIComponent(campaignId)}`,
    {
      method:
        'GET'
    }
  );
}

async function getCampaignAnalytics(
  params = {}
) {
  return request(
    '/campaigns/analytics',
    {
      method:
        'GET',
      params
    }
  );
}

async function getCampaignAnalyticsOverview(
  params = {}
) {
  return request(
    '/campaigns/analytics/overview',
    {
      method:
        'GET',
      params
    }
  );
}

async function getCampaignDailyAnalytics(
  params = {}
) {
  return request(
    '/campaigns/analytics/daily',
    {
      method:
        'GET',
      params
    }
  );
}

async function getCampaignStepsAnalytics(
  params = {}
) {
  return request(
    '/campaigns/analytics/steps',
    {
      method:
        'GET',
      params
    }
  );
}

async function listAccounts(params = {}) {
  return request(
    '/accounts',
    {
      method:
        'GET',
      params
    }
  );
}

async function testAccountVitals(emails = []) {
  if (
    !Array.isArray(emails) ||
    emails.length === 0
  ) {
    throw new Error(
      'emails must be a non-empty array.'
    );
  }

  return request(
    '/accounts/test/vitals',
    {
      method:
        'POST',
      body: {
        emails
      }
    }
  );
}

async function getWarmupAnalytics(
  payload = {}
) {
  return request(
    '/accounts/warmup-analytics',
    {
      method:
        'POST',
      body:
        payload
    }
  );
}

async function getDailyAccountAnalytics(
  params = {}
) {
  return request(
    '/accounts/analytics/daily',
    {
      method:
        'GET',
      params
    }
  );
}

async function listLeads(filters = {}) {
  return request(
    '/leads/list',
    {
      method:
        'POST',
      body:
        filters
    }
  );
}

async function createCampaign(payload = {}) {
  if (
    !payload ||
    typeof payload !== 'object'
  ) {
    throw new Error(
      'Campaign payload is required.'
    );
  }

  if (!mayExecuteMutation()) {
    return buildMutationResult(
      'createCampaign',
      {
        method:
          'POST',
        endpoint:
          '/campaigns',
        body:
          payload
      }
    );
  }

  return request(
    '/campaigns',
    {
      method:
        'POST',
      body:
        payload
    }
  );
}

async function updateCampaign(
  campaignId,
  payload = {}
) {
  if (!campaignId) {
    throw new Error(
      'campaignId is required.'
    );
  }

  if (
    !payload ||
    typeof payload !== 'object'
  ) {
    throw new Error(
      'Campaign update payload is required.'
    );
  }

  const endpoint =
    `/campaigns/${encodeURIComponent(campaignId)}`;

  if (!mayExecuteMutation()) {
    return buildMutationResult(
      'updateCampaign',
      {
        method:
          'PATCH',
        endpoint,
        body:
          payload
      }
    );
  }

  return request(
    endpoint,
    {
      method:
        'PATCH',
      body:
        payload
    }
  );
}

async function pauseCampaign(
  campaignId,
  reason = ''
) {
  if (!campaignId) {
    throw new Error(
      'campaignId is required.'
    );
  }

  const endpoint =
    `/campaigns/${encodeURIComponent(campaignId)}/pause`;

  if (!mayExecuteMutation()) {
    return buildMutationResult(
      'pauseCampaign',
      {
        method:
          'POST',
        endpoint,
        reason:
          reason ||
          'No reason supplied.'
      }
    );
  }

  const result =
    await request(
      endpoint,
      {
        method:
          'POST'
      }
    );

  return {
    campaignId,
    action:
      'pause',
    reason:
      reason ||
      'No reason supplied.',
    result
  };
}

async function activateCampaign(campaignId) {
  if (!campaignId) {
    throw new Error(
      'campaignId is required.'
    );
  }

  const endpoint =
    `/campaigns/${encodeURIComponent(campaignId)}/activate`;

  if (!mayExecuteMutation()) {
    return buildMutationResult(
      'activateCampaign',
      {
        method:
          'POST',
        endpoint
      }
    );
  }

  return request(
    endpoint,
    {
      method:
        'POST'
    }
  );
}

async function deleteCampaign(
  campaignId,
  confirmation = ''
) {
  if (!campaignId) {
    throw new Error(
      'campaignId is required.'
    );
  }

  const requiredConfirmation =
    `DELETE:${campaignId}`;

  if (
    confirmation !==
    requiredConfirmation
  ) {
    return {
      ok: false,
      mutationExecuted:
        false,
      provider:
        'Instantly',
      action:
        'deleteCampaign',
      error:
        'Exact deletion confirmation is required.',
      requiredConfirmation
    };
  }

  const endpoint =
    `/campaigns/${encodeURIComponent(campaignId)}`;

  if (!mayExecuteMutation()) {
    return buildMutationResult(
      'deleteCampaign',
      {
        method:
          'DELETE',
        endpoint,
        confirmation
      }
    );
  }

  return request(
    endpoint,
    {
      method:
        'DELETE'
    }
  );
}

async function createLead(payload = {}) {
  if (
    !payload ||
    typeof payload !== 'object'
  ) {
    throw new Error(
      'Lead payload is required.'
    );
  }

  if (
    !payload.email &&
    !payload.contact
  ) {
    throw new Error(
      'Lead email/contact is required.'
    );
  }

  if (
    !payload.campaign &&
    !payload.campaign_id &&
    !payload.list_id
  ) {
    throw new Error(
      'campaign, campaign_id, or list_id is required.'
    );
  }

  if (!mayExecuteMutation()) {
    return buildMutationResult(
      'createLead',
      {
        method:
          'POST',
        endpoint:
          '/leads',
        body:
          payload
      }
    );
  }

  return request(
    '/leads',
    {
      method:
        'POST',
      body:
        payload
    }
  );
}

function getConfiguration() {
  return {
    provider:
      'Instantly',
    apiVersion:
      'v2',
    baseUrl:
      BASE_URL,
    apiKeyConfigured:
      Boolean(API_KEY),
    requestTimeoutMs:
      REQUEST_TIMEOUT_MS,
    maxRetries:
      MAX_RETRIES,
    dryRun:
      DRY_RUN,
    mutationsAllowed:
      MUTATIONS_ALLOWED,
    liveMutationsEnabled:
      mayExecuteMutation(),
    mutatingActions: [
      ...MUTATING_ACTIONS
    ]
  };
}

module.exports = {
  request,

  healthCheck,
  getConfiguration,

  listCampaigns,
  getCampaign,

  getCampaignAnalytics,
  getCampaignAnalyticsOverview,
  getCampaignDailyAnalytics,
  getCampaignStepsAnalytics,

  listAccounts,
  testAccountVitals,
  getWarmupAnalytics,
  getDailyAccountAnalytics,

  listLeads,
  createLead,

  createCampaign,
  updateCampaign,
  pauseCampaign,
  activateCampaign,
  deleteCampaign
};