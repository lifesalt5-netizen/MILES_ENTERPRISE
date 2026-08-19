'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = root;

const calendar = require(path.join(root, 'CONNECTORS', 'GOOGLE', 'calendar.js'));
const accountManager = require(path.join(root, 'CONNECTORS', 'GOOGLE', 'account_manager.js'));

const outDir = path.join(root, 'DATA', 'operational_acceptance');
const outJson = path.join(outDir, 'latest_meeting_pipeline_acceptance.json');
const outMd = path.join(outDir, 'latest_meeting_pipeline_acceptance.md');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function textOf(event = {}) {
  return [
    event.summary,
    event.description,
    event.location,
    event.organizer?.email,
    event.creator?.email,
    ...(Array.isArray(event.attendees) ? event.attendees.map(a => a.email) : [])
  ].filter(Boolean).join(' ').toLowerCase();
}
function eventStart(event = {}) { return event.start?.dateTime || event.start?.date || null; }
function eventEnd(event = {}) { return event.end?.dateTime || event.end?.date || null; }
function classify(event = {}) {
  const text = textOf(event);
  const p2gcPatterns = [
    'pathways2gc',
    'pathways 2 government',
    'pathways 2 gc',
    '@pathways2gc.com',
    'government contracting',
    'govcon',
    'gsa schedule',
    'sam.gov',
    'federal contracting',
    'executive government growth blueprint'
  ];
  const p2gc = p2gcPatterns.some(pattern => text.includes(pattern));
  const calendly = text.includes('calendly.com') || text.includes('calendly');
  return { p2gc, calendly };
}
function slimEvent(account, event, classification) {
  return {
    account,
    id: event.id || null,
    summary: event.summary || '(untitled)',
    start: eventStart(event),
    end: eventEnd(event),
    status: event.status || null,
    organizer: event.organizer?.email || null,
    creator: event.creator?.email || null,
    attendeeCount: Array.isArray(event.attendees) ? event.attendees.length : 0,
    p2gc: classification.p2gc,
    calendly: classification.calendly
  };
}

(async () => {
  const now = Date.now();
  const timeMin = new Date(now - 120 * 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(now + 30 * 24 * 3600 * 1000).toISOString();
  const accounts = accountManager.listAccounts();
  const accountResults = [];
  const p2gcEvents = [];
  const calendlyEvents = [];
  let totalEvents = 0;

  for (const account of accounts) {
    const accountId = account.email || account.accountKey;
    const row = { account: accountId, tokenPresent: Boolean(account.valid), calendarReachable: false, eventsReturned: 0, error: null };
    if (!account.valid) {
      row.error = 'TOKEN_INVALID_OR_MISSING';
      accountResults.push(row);
      continue;
    }
    try {
      const health = await calendar.healthCheck(accountId);
      row.calendarReachable = Boolean(health.ok);
      if (!health.ok) {
        row.error = health.error || 'CALENDAR_HEALTH_FAILED';
        accountResults.push(row);
        continue;
      }
      const events = await calendar.listEvents(accountId, { calendarId: 'primary', timeMin, timeMax, maxResults: 250 });
      row.eventsReturned = events.length;
      totalEvents += events.length;
      for (const event of events) {
        const classification = classify(event);
        const slim = slimEvent(accountId, event, classification);
        if (classification.p2gc) p2gcEvents.push(slim);
        if (classification.calendly) calendlyEvents.push(slim);
      }
    } catch (error) {
      row.error = error.message;
    }
    accountResults.push(row);
  }

  const healthyAccounts = accountResults.filter(r => r.calendarReachable).length;
  const checks = {
    google_calendar_accounts: accounts.length > 0 ? (healthyAccounts > 0 ? 'GREEN' : 'RED') : 'RED',
    calendar_read_connectivity: healthyAccounts > 0 ? 'GREEN' : 'RED',
    p2gc_meeting_evidence: p2gcEvents.length > 0 ? 'GREEN' : 'RED',
    calendly_event_visibility: calendlyEvents.length > 0 ? 'GREEN' : 'YELLOW'
  };

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY_CALENDAR_AUDIT',
    externalWritesPerformed: false,
    window: { timeMin, timeMax },
    checks,
    accountResults,
    totals: {
      configuredAccounts: accounts.length,
      healthyAccounts,
      eventsReturned: totalEvents,
      p2gcMeetings: p2gcEvents.length,
      calendlyEvents: calendlyEvents.length
    },
    p2gcEvents,
    calendlyEvents,
    nextPriority: healthyAccounts === 0
      ? 'RESTORE_GOOGLE_CALENDAR_ACCOUNT_AUTH'
      : p2gcEvents.length === 0
        ? 'VERIFY_P2GC_CALENDLY_TARGET_CALENDAR_OR_NO_RECENT_BOOKINGS'
        : 'WIRE_MEETING_EVIDENCE_INTO_EXECUTIVE_BRIEF'
  };

  ensureDir(outDir);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# MILES Meeting Pipeline Acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `External writes performed: ${report.externalWritesPerformed}`,
    '',
    '## Status',
    ...Object.entries(checks).map(([k,v]) => `- ${k}: ${v}`),
    '',
    '## Totals',
    `- configured Google accounts: ${report.totals.configuredAccounts}`,
    `- healthy calendar accounts: ${report.totals.healthyAccounts}`,
    `- calendar events read: ${report.totals.eventsReturned}`,
    `- P2GC meeting evidence: ${report.totals.p2gcMeetings}`,
    `- Calendly events visible: ${report.totals.calendlyEvents}`,
    '',
    '## Next priority',
    `- ${report.nextPriority}`,
    ''
  ];
  fs.writeFileSync(outMd, lines.join('\n'), 'utf8');

  console.log('============================================================');
  console.log('MILES MEETING PIPELINE ACCEPTANCE - READ ONLY');
  console.log('============================================================');
  for (const [k,v] of Object.entries(checks)) console.log(`${k}: ${v}`);
  console.log('');
  console.log(`Configured Google accounts: ${report.totals.configuredAccounts}`);
  console.log(`Healthy calendar accounts: ${report.totals.healthyAccounts}`);
  console.log(`Calendar events read: ${report.totals.eventsReturned}`);
  console.log(`P2GC meeting evidence: ${report.totals.p2gcMeetings}`);
  console.log(`Calendly events visible: ${report.totals.calendlyEvents}`);
  for (const row of accountResults) {
    console.log(`Account ${row.account}: calendarReachable=${row.calendarReachable} events=${row.eventsReturned}${row.error ? ` error=${row.error}` : ''}`);
  }
  console.log(`Next priority: ${report.nextPriority}`);
  console.log(`Report: ${outJson}`);
  console.log(`Summary: ${outMd}`);
  process.exitCode = healthyAccounts > 0 ? 0 : 2;
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
