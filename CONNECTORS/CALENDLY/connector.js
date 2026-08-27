'use strict';

const BASE_URL = 'https://api.calendly.com';
const MAX_RATE_LIMIT_RETRIES = Math.max(0, Number(process.env.MILES_CALENDLY_429_RETRIES || 5));
const DEFAULT_RATE_LIMIT_DELAY_MS = Math.max(250, Number(process.env.MILES_CALENDLY_429_DELAY_MS || 1500));
const MAX_RATE_LIMIT_DELAY_MS = Math.max(DEFAULT_RATE_LIMIT_DELAY_MS, Number(process.env.MILES_CALENDLY_429_MAX_DELAY_MS || 15000));

function getToken() {
  const token = String(process.env.CALENDLY_PERSONAL_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('CALENDLY_PERSONAL_ACCESS_TOKEN is not configured.');
  return token;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelayMs(response, attempt) {
  const raw = response?.headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(250, seconds * 1000));
    const when = Date.parse(raw);
    if (Number.isFinite(when)) return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(250, when - Date.now()));
  }
  return Math.min(MAX_RATE_LIMIT_DELAY_MS, DEFAULT_RATE_LIMIT_DELAY_MS * Math.pow(2, Math.max(0, attempt)));
}

async function request(pathname, params = {}) {
  const token = getToken();
  const url = new URL(pathname, BASE_URL);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }

    if (response.ok) return body;

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const delayMs = retryDelayMs(response, attempt);
      console.warn(`[CALENDLY] API 429 rate limit; retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} in ${delayMs}ms for ${pathname}`);
      await sleep(delayMs);
      continue;
    }

    const error = new Error(`Calendly API ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    error.statusCode = response.status;
    error.retryAttempts = attempt;
    throw error;
  }

  throw new Error('Calendly request retry loop exhausted unexpectedly.');
}

async function getCurrentUser() {
  const body = await request('/users/me');
  return body && body.resource ? body.resource : null;
}

async function listScheduledEvents(options = {}) {
  const user = options.user || null;
  const organization = options.organization || null;
  if (!user && !organization) throw new Error('Calendly organization or user URI is required.');

  const count = Math.min(Math.max(Number(options.count || 100), 1), 100);
  const maxPages = Math.min(Math.max(Number(options.maxPages || 5), 1), 20);
  const items = [];
  let pageToken = options.pageToken || null;

  for (let page = 0; page < maxPages; page++) {
    const body = await request('/scheduled_events', {
      organization,
      user,
      count,
      status: options.status || undefined,
      min_start_time: options.minStartTime || undefined,
      max_start_time: options.maxStartTime || undefined,
      page_token: pageToken || undefined,
      sort: options.sort || 'start_time:desc'
    });

    items.push(...(Array.isArray(body?.collection) ? body.collection : []));
    pageToken = body?.pagination?.next_page_token || null;
    if (!pageToken) break;
  }

  return items;
}

function eventUuidFromUri(uri) {
  const match = String(uri || '').match(/\/scheduled_events\/([^/?#]+)/i);
  return match ? match[1] : null;
}

async function listEventInvitees(eventUriOrUuid, options = {}) {
  const uuid = eventUuidFromUri(eventUriOrUuid) || String(eventUriOrUuid || '').trim();
  if (!uuid) throw new Error('Scheduled event URI or UUID is required.');

  const count = Math.min(Math.max(Number(options.count || 100), 1), 100);
  const maxPages = Math.min(Math.max(Number(options.maxPages || 5), 1), 20);
  const items = [];
  let pageToken = null;

  for (let page = 0; page < maxPages; page++) {
    const body = await request(`/scheduled_events/${encodeURIComponent(uuid)}/invitees`, {
      count,
      page_token: pageToken || undefined,
      sort: options.sort || 'created_at:desc'
    });
    items.push(...(Array.isArray(body?.collection) ? body.collection : []));
    pageToken = body?.pagination?.next_page_token || null;
    if (!pageToken) break;
  }
  return items;
}

async function healthCheck() {
  try {
    const user = await getCurrentUser();
    return {
      service: 'CALENDLY',
      ok: Boolean(user?.uri),
      email: user?.email || null,
      organization: user?.current_organization || null,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      service: 'CALENDLY',
      ok: false,
      statusCode: error.statusCode || null,
      error: error.message,
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  getCurrentUser,
  listScheduledEvents,
  listEventInvitees,
  healthCheck,
  eventUuidFromUri,
  retryDelayMs,
  MAX_RATE_LIMIT_RETRIES,
  DEFAULT_RATE_LIMIT_DELAY_MS,
  MAX_RATE_LIMIT_DELAY_MS
};
