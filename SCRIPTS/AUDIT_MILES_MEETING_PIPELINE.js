'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = root;
try {
  const dotenv = require(path.join(root, 'node_modules', 'dotenv'));
  dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true });
} catch {}

const calendar = require(path.join(root, 'CONNECTORS', 'GOOGLE', 'calendar.js'));
const accountManager = require(path.join(root, 'CONNECTORS', 'GOOGLE', 'account_manager.js'));
const CalendlyRevenuePipelineService = require(path.join(root, 'SERVICES', 'CalendlyRevenuePipelineService.js'));

const outDir = path.join(root, 'DATA', 'operational_acceptance');
const outJson = path.join(outDir, 'latest_meeting_pipeline_acceptance.json');
const outMd = path.join(outDir, 'latest_meeting_pipeline_acceptance.md');
const calendlyAcceptancePath = path.join(outDir, 'latest_calendly_pipeline_acceptance.json');
const MAX_CALENDARS_PER_ACCOUNT = Number(process.env.MILES_MEETING_MAX_CALENDARS || 25);
const MAX_CALENDLY_ACCEPTANCE_AGE_HOURS = Number(process.env.MILES_MEETING_CALENDLY_FALLBACK_MAX_AGE_HOURS || 24);

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
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
function slimEvent(account, event, classification, calendarMeta = {}) {
  return {
    account,
    calendarId: calendarMeta.id || null,
    calendarSummary: calendarMeta.summary || null,
    calendarPrimary: Boolean(calendarMeta.primary),
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
function freshCalendlyAcceptance(report, maxAgeHours = MAX_CALENDLY_ACCEPTANCE_AGE_HOURS) {
  if (!report || !report.generatedAt || !report.checks || !report.inventory) return false;
  const generatedMs = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedMs)) return false;
  const ageHours = (Date.now() - generatedMs) / 3600000;
  if (ageHours < 0 || ageHours > maxAgeHours) return false;
  return report.checks.calendly_authentication === 'GREEN' &&
    report.checks.scheduled_event_visibility === 'GREEN' &&
    report.checks.p2gc_booking_visibility === 'GREEN' &&
    report.checks.invitee_visibility === 'GREEN' &&
    Number(report.inventory.p2gcEvents || 0) > 0 &&
    Number(report.inventory.invitees || 0) > 0;
}
function calendlyFallbackFromAcceptance(report) {
  if (!freshCalendlyAcceptance(report)) return null;
  const inventory = report.inventory || {};
  return {
    ok: true,
    status: 'CALENDLY_ACCEPTANCE_LAST_KNOWN_GOOD',
    generatedAt: report.generatedAt,
    account: report.account || null,
    metrics: {
      p2gcEvents: Number(inventory.p2gcEvents || 0),
      meetings: Number(inventory.p2gcEvents || 0),
      invitees: Number(inventory.invitees || 0),
      activeP2GC: Number(inventory.activeP2GC || 0),
      canceledP2GC: Number(inventory.canceledP2GC || 0)
    },
    upcomingMeetings: [],
    recentMeetings: [],
    fallbackEvidencePath: path.relative(root, calendlyAcceptancePath),
    externalWritesPerformed: false
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
  let totalCalendarsScanned = 0;

  for (const account of accounts) {
    const accountId = account.email || account.accountKey;
    const row = {
      account: accountId,
      tokenPresent: Boolean(account.valid),
      calendarReachable: false,
      calendarsVisible: 0,
      calendarsScanned: 0,
      eventsReturned: 0,
      calendarErrors: [],
      error: null
    };
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

      let visibleCalendars = await calendar.listCalendars(accountId, { maxResults: MAX_CALENDARS_PER_ACCOUNT });
      visibleCalendars = Array.isArray(visibleCalendars) ? visibleCalendars.filter(c => c?.id).slice(0, MAX_CALENDARS_PER_ACCOUNT) : [];
      if (!visibleCalendars.length) visibleCalendars = [{ id: 'primary', summary: 'Primary', primary: true }];
      row.calendarsVisible = visibleCalendars.length;

      for (const cal of visibleCalendars) {
        try {
          const events = await calendar.listEvents(accountId, { calendarId: cal.id, timeMin, timeMax, maxResults: 250 });
          row.calendarsScanned += 1;
          totalCalendarsScanned += 1;
          row.eventsReturned += events.length;
          totalEvents += events.length;
          for (const event of events) {
            const classification = classify(event);
            const slim = slimEvent(accountId, event, classification, cal);
            if (classification.p2gc) p2gcEvents.push(slim);
            if (classification.calendly) calendlyEvents.push(slim);
          }
        } catch (error) {
          row.calendarErrors.push({ calendarId: cal.id, summary: cal.summary || null, error: error.message });
        }
      }
    } catch (error) {
      row.error = error.message;
    }
    accountResults.push(row);
  }

  let calendlyPipeline = null;
  let calendlyPipelineError = null;
  let calendlyEvidenceSource = 'LIVE_REFRESH';
  try {
    calendlyPipeline = await new CalendlyRevenuePipelineService({ rootDir: root }).runOnce({ lookbackDays: 180, lookaheadDays: 90 });
  } catch (error) {
    calendlyPipelineError = error.message;
  }

  if (!calendlyPipeline || calendlyPipeline.ok !== true) {
    const fallbackReport = readJson(calendlyAcceptancePath);
    const fallback = calendlyFallbackFromAcceptance(fallbackReport);
    if (fallback) {
      calendlyEvidenceSource = 'FRESH_ACCEPTANCE_FALLBACK';
      calendlyPipeline = {
        ...fallback,
        liveRefreshError: calendlyPipelineError || null
      };
    }
  }

  const healthyAccounts = accountResults.filter(r => r.calendarReachable).length;
  const directCalendlyP2gcEvents = Number(calendlyPipeline?.metrics?.p2gcEvents || 0);
  const directCalendlyMeetings = Number(calendlyPipeline?.metrics?.meetings || 0);
  const directCalendlyEvidence = Boolean(calendlyPipeline?.ok && (directCalendlyP2gcEvents > 0 || directCalendlyMeetings > 0));
  const googleP2gcEvidence = p2gcEvents.length > 0;
  const combinedMeetingEvidence = googleP2gcEvidence || directCalendlyEvidence;
  const googleCalendarSyncStatus = googleP2gcEvidence ? 'GREEN' : 'YELLOW';

  const checks = {
    google_calendar_accounts: accounts.length > 0 ? (healthyAccounts > 0 ? 'GREEN' : 'RED') : 'RED',
    calendar_read_connectivity: healthyAccounts > 0 ? 'GREEN' : 'RED',
    google_calendar_inventory_scan: totalCalendarsScanned > 0 ? 'GREEN' : 'RED',
    calendly_direct_read: calendlyEvidenceSource === 'LIVE_REFRESH' && calendlyPipeline?.ok === true ? 'GREEN' : (directCalendlyEvidence ? 'YELLOW' : 'RED'),
    p2gc_meeting_evidence: combinedMeetingEvidence ? 'GREEN' : 'RED',
    calendly_event_visibility: directCalendlyEvidence ? 'GREEN' : (calendlyEvents.length > 0 ? 'YELLOW' : 'RED'),
    google_calendar_p2gc_sync: googleCalendarSyncStatus
  };

  const fallbackUsed = calendlyEvidenceSource === 'FRESH_ACCEPTANCE_FALLBACK';
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY_MEETING_SOURCE_RECONCILIATION',
    externalWritesPerformed: false,
    window: { timeMin, timeMax },
    checks,
    accountResults,
    totals: {
      configuredAccounts: accounts.length,
      healthyAccounts,
      calendarsScanned: totalCalendarsScanned,
      eventsReturned: totalEvents,
      googleCalendarP2gcMeetings: p2gcEvents.length,
      googleCalendarCalendlyEvents: calendlyEvents.length,
      calendlyP2gcEvents: directCalendlyP2gcEvents,
      calendlyMeetings: directCalendlyMeetings
    },
    sourceAuthority: {
      bookingSource: 'CALENDLY',
      googleCalendarRole: 'SUPPLEMENTAL_VISIBILITY',
      googleCalendarRequiredForBookingTruth: false,
      rule: 'Fresh evidence-backed Calendly booking truth is authoritative; Google visible-calendar sync is monitored separately and must not erase confirmed Calendly bookings.'
    },
    evidenceSources: {
      googleCalendar: {
        ok: healthyAccounts > 0 && totalCalendarsScanned > 0,
        scanScope: 'ALL_VISIBLE_CALENDARS_BOUNDED',
        maxCalendarsPerAccount: MAX_CALENDARS_PER_ACCOUNT,
        p2gcMeetingEvidence: googleP2gcEvidence,
        p2gcEvents
      },
      calendly: {
        ok: calendlyPipeline?.ok === true,
        p2gcMeetingEvidence: directCalendlyEvidence,
        metrics: calendlyPipeline?.metrics || null,
        upcomingMeetings: calendlyPipeline?.upcomingMeetings || [],
        recentMeetings: calendlyPipeline?.recentMeetings || [],
        evidenceSource: calendlyEvidenceSource,
        liveRefreshError: calendlyPipelineError || calendlyPipeline?.liveRefreshError || null,
        fallbackEvidencePath: calendlyPipeline?.fallbackEvidencePath || null,
        fallbackMaxAgeHours: MAX_CALENDLY_ACCEPTANCE_AGE_HOURS
      }
    },
    sourceTruth: !directCalendlyEvidence
      ? (calendlyPipelineError ? 'CALENDLY_DIRECT_PIPELINE_READ_FAILED_NO_FRESH_ACCEPTANCE_FALLBACK' : 'P2GC_MEETING_EVIDENCE_NOT_OBSERVED')
      : fallbackUsed
        ? (googleP2gcEvidence
            ? 'P2GC_MEETING_EVIDENCE_CONFIRMED_BY_FRESH_CALENDLY_ACCEPTANCE_AND_GOOGLE'
            : 'P2GC_MEETING_EVIDENCE_CONFIRMED_BY_FRESH_CALENDLY_ACCEPTANCE_GOOGLE_VISIBLE_CALENDAR_SYNC_NOT_OBSERVED')
        : (googleP2gcEvidence
            ? 'P2GC_MEETING_EVIDENCE_CONFIRMED_GOOGLE_CALENDAR_AND_OR_CALENDLY'
            : 'P2GC_MEETING_EVIDENCE_CONFIRMED_BY_CALENDLY_GOOGLE_VISIBLE_CALENDAR_SYNC_NOT_OBSERVED'),
    nextPriority: healthyAccounts === 0
      ? 'RESTORE_GOOGLE_CALENDAR_ACCOUNT_AUTH'
      : !directCalendlyEvidence
        ? 'RESTORE_CALENDLY_DIRECT_PIPELINE_READ'
        : fallbackUsed
          ? 'RETRY_CALENDLY_LIVE_REFRESH_WITHOUT_INVALIDATING_BOOKING_TRUTH'
          : !googleP2gcEvidence
            ? 'GOOGLE_CALENDAR_SYNC_SUPPLEMENTAL_ONLY'
            : 'WIRE_MEETING_EVIDENCE_INTO_EXECUTIVE_BRIEF_AND_REVENUE_PIPELINE'
  };

  ensureDir(outDir);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# MILES Meeting Pipeline Acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `External writes performed: ${report.externalWritesPerformed}`,
    `Authoritative booking source: ${report.sourceAuthority.bookingSource}`,
    `Google Calendar role: ${report.sourceAuthority.googleCalendarRole}`,
    '',
    '## Status',
    ...Object.entries(checks).map(([k,v]) => `- ${k}: ${v}`),
    '',
    '## Totals',
    `- configured Google accounts: ${report.totals.configuredAccounts}`,
    `- healthy calendar accounts: ${report.totals.healthyAccounts}`,
    `- Google calendars scanned: ${report.totals.calendarsScanned}`,
    `- Google Calendar events read: ${report.totals.eventsReturned}`,
    `- Google Calendar P2GC meeting evidence: ${report.totals.googleCalendarP2gcMeetings}`,
    `- Calendly P2GC events: ${report.totals.calendlyP2gcEvents}`,
    `- Calendly meetings: ${report.totals.calendlyMeetings}`,
    `- Calendly evidence source: ${calendlyEvidenceSource}`,
    `- Calendly live pipeline error: ${calendlyPipelineError || 'none'}`,
    '',
    '## Source truth',
    `- ${report.sourceTruth}`,
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
  console.log(`Google calendars scanned: ${report.totals.calendarsScanned}`);
  console.log(`Google Calendar events read: ${report.totals.eventsReturned}`);
  console.log(`Google Calendar P2GC meeting evidence: ${report.totals.googleCalendarP2gcMeetings}`);
  console.log(`Calendly P2GC events: ${report.totals.calendlyP2gcEvents}`);
  console.log(`Calendly meetings: ${report.totals.calendlyMeetings}`);
  console.log(`Calendly evidence source: ${calendlyEvidenceSource}`);
  console.log(`Calendly live pipeline error: ${calendlyPipelineError || 'none'}`);
  console.log(`Source truth: ${report.sourceTruth}`);
  for (const row of accountResults) {
    console.log(`Account ${row.account}: calendarReachable=${row.calendarReachable} calendars=${row.calendarsScanned}/${row.calendarsVisible} events=${row.eventsReturned}${row.error ? ` error=${row.error}` : ''}`);
  }
  console.log(`Next priority: ${report.nextPriority}`);
  console.log(`Report: ${outJson}`);
  console.log(`Summary: ${outMd}`);
  process.exitCode = healthyAccounts > 0 && totalCalendarsScanned > 0 && directCalendlyEvidence ? 0 : 2;
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
