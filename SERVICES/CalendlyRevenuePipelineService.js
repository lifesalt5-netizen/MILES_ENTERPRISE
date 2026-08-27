'use strict';

const fs = require('fs');
const path = require('path');
const calendly = require('../CONNECTORS/CALENDLY/connector');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isP2GCEvent(event) {
  const text = [event?.name, event?.event_type, event?.location?.location].filter(Boolean).join(' ');
  return /(Federal Strategy|Pathways\s*2|P2GC|Gov.?t Contract|Government Contract)/i.test(text);
}

function answerMap(invitee) {
  const out = {};
  for (const qa of Array.isArray(invitee?.questions_and_answers) ? invitee.questions_and_answers : []) {
    const key = String(qa?.question || '').trim();
    if (key) out[key] = qa?.answer ?? null;
  }
  return out;
}

class CalendlyRevenuePipelineService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || process.cwd();
    this.outputDir = path.join(this.rootDir, 'DATA', 'revenue_pipeline');
    this.outputJson = path.join(this.outputDir, 'latest_calendly_meeting_pipeline.json');
    this.outputMd = path.join(this.outputDir, 'latest_calendly_meeting_pipeline.md');
  }

  async runOnce(options = {}) {
    const now = new Date();
    const min = new Date(now.getTime() - Number(options.lookbackDays || 180) * 86400000).toISOString();
    const max = new Date(now.getTime() + Number(options.lookaheadDays || 90) * 86400000).toISOString();

    const user = await calendly.getCurrentUser();
    if (!user?.uri) throw new Error('Calendly current user URI was not returned.');

    const events = await calendly.listScheduledEvents({
      organization: user.current_organization,
      count: 100,
      maxPages: 10,
      minStartTime: min,
      maxStartTime: max,
      sort: 'start_time:desc'
    });

    const p2gcEvents = events.filter(isP2GCEvent);
    const meetings = [];

    for (const event of p2gcEvents) {
      const invitees = await calendly.listEventInvitees(event.uri, { count: 100, maxPages: 5 });
      for (const invitee of invitees) {
        meetings.push({
          eventUri: event.uri || null,
          eventName: event.name || null,
          startTime: event.start_time || null,
          endTime: event.end_time || null,
          eventStatus: event.status || null,
          location: event.location || null,
          inviteeUri: invitee.uri || null,
          inviteeName: invitee.name || null,
          inviteeEmail: invitee.email || null,
          inviteeStatus: invitee.status || null,
          inviteeTimezone: invitee.timezone || null,
          createdAt: invitee.created_at || null,
          canceled: Boolean(invitee.canceled),
          cancellation: invitee.cancellation || null,
          questionsAndAnswers: answerMap(invitee)
        });
      }
    }

    const active = meetings.filter(m => m.eventStatus === 'active' && !m.canceled);
    const upcoming = active.filter(m => m.startTime && new Date(m.startTime).getTime() >= now.getTime());
    const completedOrPast = active.filter(m => m.startTime && new Date(m.startTime).getTime() < now.getTime());
    const canceled = meetings.filter(m => m.eventStatus === 'canceled' || m.canceled);

    const record = {
      ok: true,
      status: 'Healthy',
      source: 'CALENDLY',
      generatedAt: new Date().toISOString(),
      account: user.email || null,
      organization: user.current_organization || null,
      window: { minStartTime: min, maxStartTime: max },
      metrics: {
        scheduledEventsRead: events.length,
        p2gcEvents: p2gcEvents.length,
        meetings: meetings.length,
        activeMeetings: active.length,
        upcomingMeetings: upcoming.length,
        pastActiveMeetings: completedOrPast.length,
        canceledMeetings: canceled.length
      },
      upcomingMeetings: upcoming.sort((a,b) => new Date(a.startTime) - new Date(b.startTime)),
      recentMeetings: completedOrPast.sort((a,b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, 25),
      canceledMeetings: canceled.sort((a,b) => new Date(b.startTime || 0) - new Date(a.startTime || 0)).slice(0, 25),
      safety: {
        calendlyReadOnly: true,
        externalWritesPerformed: false
      }
    };

    ensureDir(this.outputDir);
    fs.writeFileSync(this.outputJson, JSON.stringify(record, null, 2), 'utf8');

    const lines = [
      '# MILES Calendly Revenue Meeting Pipeline',
      '',
      `Generated: ${record.generatedAt}`,
      `Account: ${record.account || 'unknown'}`,
      `P2GC events: ${record.metrics.p2gcEvents}`,
      `Active meetings: ${record.metrics.activeMeetings}`,
      `Upcoming meetings: ${record.metrics.upcomingMeetings}`,
      `Past active meetings: ${record.metrics.pastActiveMeetings}`,
      `Canceled meetings: ${record.metrics.canceledMeetings}`,
      '',
      '## Upcoming',
      ...(record.upcomingMeetings.length ? record.upcomingMeetings.map(m => `- ${m.startTime} | ${m.inviteeName || 'Unknown'} | ${m.inviteeEmail || 'No email'} | ${m.eventName}`) : ['- None']),
      '',
      '## Recent',
      ...(record.recentMeetings.length ? record.recentMeetings.slice(0, 10).map(m => `- ${m.startTime} | ${m.inviteeName || 'Unknown'} | ${m.inviteeEmail || 'No email'} | ${m.eventName}`) : ['- None'])
    ];
    fs.writeFileSync(this.outputMd, lines.join('\n') + '\n', 'utf8');

    return record;
  }
}

module.exports = CalendlyRevenuePipelineService;
module.exports.isP2GCEvent = isP2GCEvent;
