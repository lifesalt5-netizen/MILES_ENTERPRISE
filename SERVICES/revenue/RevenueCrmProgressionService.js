'use strict';

const fs = require('fs');
const path = require('path');

const QUALIFIED_CATEGORIES = new Set([
  'INTERESTED',
  'MEETING_INTENT',
  'PRICING_QUESTION',
  'REFERRAL'
]);

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

class RevenueCrmProgressionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.crm = options.crm || this.loadCrm();
    this.qualifiedReplyQueuePath = options.qualifiedReplyQueuePath || path.join(
      this.rootDir,
      'DATA', 'runtime', 'revenue', 'replies', 'qualified_reply_queue.json'
    );
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'revenue_pipeline');
    this.outputPath = path.join(this.outputDir, 'latest_crm_progression.json');
  }

  loadCrm() {
    const servicePath = path.join(this.rootDir, 'SERVICES', 'CanonicalCrmService.js');
    delete require.cache[require.resolve(servicePath)];
    return require(servicePath);
  }

  progressQualifiedReplies() {
    const rows = readJson(this.qualifiedReplyQueuePath, []);
    const candidates = Array.isArray(rows) ? rows : [];
    const writes = [];
    const skipped = [];

    for (const row of candidates) {
      const category = String(row.category || '').trim().toUpperCase();
      const email = cleanEmail(row.contactEmail || row.from || row.email);
      const qualified = QUALIFIED_CATEGORIES.has(category) && row.qualifiedPositive !== false;

      if (!qualified || !email) {
        skipped.push({
          id: row.id || null,
          email: email || null,
          category: category || null,
          reason: !qualified ? 'NOT_CANONICAL_QUALIFIED_POSITIVE' : 'MISSING_EMAIL'
        });
        continue;
      }

      const upsert = this.crm.upsertIdentity({
        email,
        companyName: row.companyName || row.company || '',
        campaignId: row.campaignId || '',
        leadId: row.leadId || '',
        replyCategory: category,
        lastQualifiedReplyAt: row.timestamp || row.processedAt || new Date().toISOString(),
        source: 'INSTANTLY_QUALIFIED_REPLY'
      }, { source: 'REVENUE_CRM_PROGRESSION' });

      const stage = this.crm.advanceStageAtLeast(
        { email },
        'Qualified',
        {
          type: 'QUALIFIED_HUMAN_REPLY',
          source: 'REPLY_INTELLIGENCE',
          category,
          campaignId: row.campaignId || null,
          sourceEmailId: row.emailId || row.reply_to_uuid || null
        }
      );

      writes.push({
        id: row.id || null,
        email,
        category,
        created: upsert.created,
        stage: stage.record?.stage || 'Qualified',
        unchanged: Boolean(stage.unchanged)
      });
    }

    return { observed: candidates.length, progressed: writes.length, writes, skipped };
  }

  reconcileCalendly(calendlyPipeline = {}) {
    const upcoming = Array.isArray(calendlyPipeline?.upcomingMeetings)
      ? calendlyPipeline.upcomingMeetings
      : [];
    const recent = Array.isArray(calendlyPipeline?.recentMeetings)
      ? calendlyPipeline.recentMeetings
      : [];

    const writes = [];
    const skipped = [];

    for (const meeting of upcoming) {
      const email = cleanEmail(meeting.inviteeEmail);
      const active = String(meeting.eventStatus || '').toLowerCase() === 'active' && !meeting.canceled;
      if (!email || !active) {
        skipped.push({
          eventUri: meeting.eventUri || null,
          email: email || null,
          reason: !email ? 'MISSING_INVITEE_EMAIL' : 'NOT_ACTIVE_MEETING'
        });
        continue;
      }

      const upsert = this.crm.upsertIdentity({
        email,
        contactName: meeting.inviteeName || '',
        calendlyEventUri: meeting.eventUri || '',
        calendlyInviteeUri: meeting.inviteeUri || '',
        nextMeetingAt: meeting.startTime || '',
        meetingName: meeting.eventName || '',
        source: 'CALENDLY'
      }, { source: 'CALENDLY_REVENUE_PIPELINE' });

      const stage = this.crm.advanceStageAtLeast(
        { email },
        'Meeting Set',
        {
          type: 'CALENDLY_ACTIVE_BOOKING',
          source: 'CALENDLY',
          eventUri: meeting.eventUri || null,
          inviteeUri: meeting.inviteeUri || null,
          startTime: meeting.startTime || null
        }
      );

      writes.push({
        email,
        eventUri: meeting.eventUri || null,
        startTime: meeting.startTime || null,
        created: upsert.created,
        stage: stage.record?.stage || 'Meeting Set',
        unchanged: Boolean(stage.unchanged)
      });
    }

    const pastMeetingEvidence = recent.map(meeting => ({
      email: cleanEmail(meeting.inviteeEmail) || null,
      eventUri: meeting.eventUri || null,
      startTime: meeting.startTime || null,
      attendanceVerified: false,
      stageChange: 'NONE',
      reason: 'PAST_CALENDLY_EVENT_IS_NOT_ATTENDANCE_EVIDENCE'
    }));

    return {
      upcomingObserved: upcoming.length,
      meetingSetProgressed: writes.length,
      writes,
      skipped,
      pastMeetingEvidenceObserved: recent.length,
      pastMeetingEvidence,
      meetingHeldAutoProgressed: 0
    };
  }

  runOnce(options = {}) {
    const reply = this.progressQualifiedReplies();
    const calendly = this.reconcileCalendly(options.calendlyPipeline || {});
    const records = typeof this.crm.listRecords === 'function' ? this.crm.listRecords() : [];
    const stageCounts = {};
    for (const record of records) {
      const stage = String(record.stage || 'Target');
      stageCounts[stage] = Number(stageCounts[stage] || 0) + 1;
    }

    const report = {
      ok: true,
      service: 'REVENUE_CRM_PROGRESSION',
      qualifiedReplyProgression: reply,
      calendlyProgression: calendly,
      crm: {
        records: records.length,
        stageCounts,
        capabilities: this.crm.getCapabilities()
      },
      evidenceRules: {
        qualifiedHumanReplyMinimumStage: 'Qualified',
        activeUpcomingCalendlyBookingMinimumStage: 'Meeting Set',
        pastCalendlyEventAloneDoesNotProve: 'Meeting Held'
      },
      generatedAt: new Date().toISOString()
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = RevenueCrmProgressionService;
module.exports.QUALIFIED_CATEGORIES = QUALIFIED_CATEGORIES;
