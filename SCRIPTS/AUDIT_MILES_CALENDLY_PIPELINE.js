'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = root;
try {
  const dotenv = require(path.join(root, 'node_modules', 'dotenv'));
  dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true });
} catch {}

const calendly = require(path.join(root, 'CONNECTORS', 'CALENDLY', 'connector.js'));
const outDir = path.join(root, 'DATA', 'operational_acceptance');
const outJson = path.join(outDir, 'latest_calendly_pipeline_acceptance.json');
const outMd = path.join(outDir, 'latest_calendly_pipeline_acceptance.md');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function isP2GCEvent(event) {
  const text = [event?.name, event?.event_type, event?.location?.location].filter(Boolean).join(' ');
  return /(Federal Strategy|Pathways\s*2|P2GC|Gov.?t Contract|Government Contract)/i.test(text);
}
function cleanQuestions(invitee) {
  return Array.isArray(invitee?.questions_and_answers)
    ? invitee.questions_and_answers.map(q => ({ question: q.question || null, answer: q.answer || null }))
    : [];
}
function summarizeInvitee(invitee) {
  return {
    name: invitee?.name || null,
    email: invitee?.email || null,
    status: invitee?.status || null,
    createdAt: invitee?.created_at || null,
    updatedAt: invitee?.updated_at || null,
    timezone: invitee?.timezone || null,
    rescheduled: Boolean(invitee?.rescheduled),
    oldInvitee: invitee?.old_invitee || null,
    newInvitee: invitee?.new_invitee || null,
    cancelUrl: invitee?.cancel_url || null,
    rescheduleUrl: invitee?.reschedule_url || null,
    questionsAndAnswers: cleanQuestions(invitee)
  };
}

(async () => {
  const generatedAt = new Date().toISOString();
  const health = await calendly.healthCheck();
  const checks = {
    calendly_authentication: health.ok ? 'GREEN' : 'RED',
    scheduled_event_visibility: 'RED',
    p2gc_booking_visibility: 'RED',
    invitee_visibility: 'RED'
  };

  let user = null;
  let events = [];
  let p2gcEvents = [];
  const meetingRows = [];
  let error = null;

  if (health.ok) {
    try {
      user = await calendly.getCurrentUser();
      events = await calendly.listScheduledEvents({
        organization: user.current_organization,
        count: 100,
        maxPages: 10,
        sort: 'start_time:desc'
      });
      checks.scheduled_event_visibility = 'GREEN';
      p2gcEvents = events.filter(isP2GCEvent);
      checks.p2gc_booking_visibility = p2gcEvents.length ? 'GREEN' : 'YELLOW';

      for (const event of p2gcEvents.slice(0, 100)) {
        let invitees = [];
        let inviteeError = null;
        try {
          invitees = await calendly.listEventInvitees(event.uri, { count: 100, maxPages: 5 });
        } catch (e) {
          inviteeError = e.message;
        }
        meetingRows.push({
          event: {
            uri: event.uri || null,
            name: event.name || null,
            status: event.status || null,
            startTime: event.start_time || null,
            endTime: event.end_time || null,
            createdAt: event.created_at || null,
            updatedAt: event.updated_at || null,
            eventType: event.event_type || null,
            location: event.location || null
          },
          invitees: invitees.map(summarizeInvitee),
          inviteeError
        });
      }

      const inviteeCount = meetingRows.reduce((sum, row) => sum + row.invitees.length, 0);
      checks.invitee_visibility = p2gcEvents.length === 0 ? 'YELLOW' : (inviteeCount > 0 ? 'GREEN' : 'RED');
    } catch (e) {
      error = e.message;
    }
  }

  const inviteeCount = meetingRows.reduce((sum, row) => sum + row.invitees.length, 0);
  const activeP2GC = p2gcEvents.filter(e => String(e.status).toLowerCase() === 'active').length;
  const canceledP2GC = p2gcEvents.filter(e => String(e.status).toLowerCase() === 'canceled').length;

  let nextPriority = 'WIRE_CALENDLY_TO_EXECUTIVE_BRIEF_AND_REVENUE_PIPELINE';
  if (!health.ok) nextPriority = 'FIX_CALENDLY_AUTHENTICATION';
  else if (checks.scheduled_event_visibility !== 'GREEN') nextPriority = 'FIX_CALENDLY_SCHEDULED_EVENT_READ';
  else if (!p2gcEvents.length) nextPriority = 'VERIFY_P2GC_EVENT_TYPE_MATCH_OR_NO_BOOKINGS';
  else if (!inviteeCount) nextPriority = 'FIX_CALENDLY_INVITEE_READ';

  const report = {
    generatedAt,
    root,
    mode: 'READ_ONLY_EXTERNAL_AUDIT',
    externalWritesPerformed: false,
    checks,
    health,
    account: user ? {
      name: user.name || null,
      email: user.email || null,
      uri: user.uri || null,
      currentOrganization: user.current_organization || null,
      schedulingUrl: user.scheduling_url || null
    } : null,
    inventory: {
      scheduledEventsRead: events.length,
      p2gcEvents: p2gcEvents.length,
      activeP2GC,
      canceledP2GC,
      invitees: inviteeCount
    },
    meetings: meetingRows,
    error,
    nextPriority
  };

  ensureDir(outDir);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# MILES Calendly Pipeline Acceptance',
    '',
    `Generated: ${generatedAt}`,
    'Mode: READ_ONLY_EXTERNAL_AUDIT',
    'External writes performed: false',
    '',
    '## Status',
    ...Object.entries(checks).map(([k,v]) => `- ${k}: ${v}`),
    '',
    '## Inventory',
    `- scheduled events read: ${events.length}`,
    `- P2GC events: ${p2gcEvents.length}`,
    `- active P2GC: ${activeP2GC}`,
    `- canceled P2GC: ${canceledP2GC}`,
    `- invitees: ${inviteeCount}`,
    '',
    '## Recent P2GC bookings',
    ...meetingRows.slice(0, 20).map(row => `- ${row.event.startTime || 'unknown'} | ${row.event.status || 'unknown'} | ${row.event.name || 'unnamed'} | invitees=${row.invitees.length}`),
    '',
    '## Next priority',
    `- ${nextPriority}`,
    ''
  ];
  fs.writeFileSync(outMd, lines.join('\n'), 'utf8');

  console.log('============================================================');
  console.log('MILES CALENDLY PIPELINE ACCEPTANCE - READ ONLY');
  console.log('============================================================');
  for (const [k,v] of Object.entries(checks)) console.log(`${k}: ${v}`);
  console.log('');
  console.log(`Calendly account: ${user?.email || health.email || 'unknown'}`);
  console.log(`Scheduled events read: ${events.length}`);
  console.log(`P2GC/Federal Strategy events: ${p2gcEvents.length}`);
  console.log(`Active P2GC events: ${activeP2GC}`);
  console.log(`Canceled P2GC events: ${canceledP2GC}`);
  console.log(`Invitees read: ${inviteeCount}`);
  console.log(`Next priority: ${nextPriority}`);
  console.log(`Report: ${outJson}`);
  console.log(`Summary: ${outMd}`);
  console.log('External writes performed: False');

  process.exitCode = health.ok && checks.scheduled_event_visibility === 'GREEN' ? 0 : 2;
})().catch(error => {
  console.error(`CALENDLY_PIPELINE_FATAL: ${error.message}`);
  process.exitCode = 1;
});
