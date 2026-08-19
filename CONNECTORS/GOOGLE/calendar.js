'use strict';

const { google } = require('googleapis');
const accountManager = require('./account_manager');

async function getCalendarClient(accountKeyOrEmail) {
  if (!accountKeyOrEmail) throw new Error('Google account key or email is required.');
  const auth = await accountManager.getAuthClientForAccount(accountKeyOrEmail);
  return google.calendar({ version: 'v3', auth });
}

async function listCalendars(accountKeyOrEmail, options = {}) {
  const calendar = await getCalendarClient(accountKeyOrEmail);
  const result = await calendar.calendarList.list({
    maxResults: Number(options.maxResults || 100)
  });
  return result.data.items || [];
}

async function listEvents(accountKeyOrEmail, options = {}) {
  const calendar = await getCalendarClient(accountKeyOrEmail);
  const result = await calendar.events.list({
    calendarId: options.calendarId || 'primary',
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    maxResults: Number(options.maxResults || 250),
    singleEvents: options.singleEvents !== false,
    orderBy: options.orderBy || 'startTime',
    q: options.query || undefined,
    showDeleted: false
  });
  return result.data.items || [];
}

async function healthCheck(accountKeyOrEmail) {
  try {
    const calendars = await listCalendars(accountKeyOrEmail, { maxResults: 1 });
    return {
      service: 'calendar',
      account: accountKeyOrEmail,
      ok: true,
      calendarsVisible: calendars.length,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      service: 'calendar',
      account: accountKeyOrEmail,
      ok: false,
      error: error.message,
      checkedAt: new Date().toISOString()
    };
  }
}

async function healthCheckAccounts() {
  const accounts = accountManager.listAccounts();
  const results = [];
  for (const account of accounts) {
    if (!account.valid) {
      results.push({ account: account.email || account.accountKey, ok: false, error: 'TOKEN_INVALID_OR_MISSING' });
      continue;
    }
    results.push(await healthCheck(account.email || account.accountKey));
  }
  return results;
}

module.exports = {
  getCalendarClient,
  listCalendars,
  listEvents,
  healthCheck,
  healthCheckAccounts
};
