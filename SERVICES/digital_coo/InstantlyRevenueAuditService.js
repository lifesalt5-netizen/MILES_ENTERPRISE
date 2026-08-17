'use strict';

/*
  MILES Enterprise
  File: SERVICES/digital_coo/InstantlyRevenueAuditService.js
  Version: 1.0.0

  Purpose:
  - Pull live Instantly API v2 campaign funnel analytics through ConnectorRuntime.
  - Diagnose where outbound revenue is leaking: delivery/list quality, reply generation,
    message/offer fit, reply handling, meeting conversion, or sales conversion.
  - Attribute replies/opportunities to sequence steps when step analytics is available.
  - Persist a local JSON and Markdown audit without mutating Instantly.

  Safety:
  - READ-ONLY.
  - No lead, campaign, account, or mailbox mutations.
  - API credentials remain in the host environment and are never persisted by this service.
*/

const fs = require('fs');
const path = require('path');
const ConnectorRuntime = require('../connector_runtime/ConnectorRuntime');

class InstantlyRevenueAuditService {
  constructor(options = {}) {
    this.service = 'INSTANTLY_REVENUE_AUDIT';
    this.version = '1.0.0';
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || process.cwd()
    );
    this.runtimeDir = path.resolve(
      options.runtimeDir || path.join(this.rootDir, 'runtime', 'instantly_revenue_audit')
    );
    this.reportDir = path.resolve(
      options.reportDir || path.join(this.rootDir, 'REPORTS', 'INSTANTLY_REVENUE_AUDIT')
    );
    this.latestJsonPath = path.join(this.runtimeDir, 'instantly_revenue_audit_latest.json');
    this.latestMarkdownPath = path.join(this.runtimeDir, 'instantly_revenue_audit_latest.md');
    this.eventLogPath = path.join(this.runtimeDir, 'instantly_revenue_audit_events.jsonl');
    this.runtime = options.runtime || new ConnectorRuntime({ rootDir: this.rootDir });

    this.thresholds = {
      minimumContacted: this.envNumber('MILES_INSTANTLY_MIN_CONTACTED_FOR_DIAGNOSIS', 100),
      highBounceRate: this.envNumber('MILES_INSTANTLY_HIGH_BOUNCE_RATE', 0.03),
      lowReplyRate: this.envNumber('MILES_INSTANTLY_LOW_REPLY_RATE', 0.01),
      healthyReplyRate: this.envNumber('MILES_INSTANTLY_HEALTHY_REPLY_RATE', 0.03),
      lowInterestedPerReply: this.envNumber('MILES_INSTANTLY_LOW_INTERESTED_PER_REPLY', 0.10),
      lowMeetingPerInterested: this.envNumber('MILES_INSTANTLY_LOW_MEETING_PER_INTERESTED', 0.30),
      lowClosedPerMeeting: this.envNumber('MILES_INSTANTLY_LOW_CLOSED_PER_MEETING', 0.15)
    };

    this.ensureStorage();
  }

  now() {
    return new Date().toISOString();
  }

  envNumber(name, fallback) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  ensureStorage() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    fs.mkdirSync(this.reportDir, { recursive: true });
    if (!fs.existsSync(this.eventLogPath)) {
      fs.writeFileSync(this.eventLogPath, '', 'utf8');
    }
  }

  appendEvent(eventType, payload = {}) {
    fs.appendFileSync(
      this.eventLogPath,
      `${JSON.stringify({ eventType, payload, generatedAt: this.now() })}\n`,
      'utf8'
    );
  }

  atomicWrite(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    try {
      fs.writeFileSync(temporaryPath, text, 'utf8');
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      try {
        fs.writeFileSync(filePath, text, 'utf8');
      } finally {
        try {
          if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        } catch {}
      }
    }
  }

  resolveItems(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.analytics)) return value.analytics;
    return [];
  }

  number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  ratio(numerator, denominator) {
    const d = this.number(denominator, 0);
    if (d <= 0) return null;
    return Number((this.number(numerator, 0) / d).toFixed(4));
  }

  humanReplies(analytics = {}, overview = {}) {
    const uniqueReplies = this.number(
      overview.reply_count_unique ?? analytics.reply_count_unique ??
      overview.reply_count ?? analytics.reply_count,
      0
    );
    const automatic = this.number(
      overview.reply_count_automatic_unique ?? analytics.reply_count_automatic_unique ??
      overview.reply_count_automatic ?? analytics.reply_count_automatic,
      0
    );
    return Math.max(0, uniqueReplies - automatic);
  }

  async executeInstantly(connectorAction, payload = {}) {
    const timeoutMs = this.envNumber('MILES_INSTANTLY_ACTION_TIMEOUT_MS', 30000);
    let timeoutHandle = null;
    const timeoutPromise = new Promise((resolve, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Instantly action ${connectorAction} timed out after ${timeoutMs} ms`)),
        timeoutMs
      );
      if (timeoutHandle && typeof timeoutHandle.unref === 'function') timeoutHandle.unref();
    });

    let result;
    try {
      result = await Promise.race([
        this.runtime.execute({
          connectorId: 'INSTANTLY',
          connectorAction,
          payload
        }),
        timeoutPromise
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    if (!result || !result.ok) {
      throw new Error(
        result?.error || result?.result?.error || `Instantly action failed: ${connectorAction}`
      );
    }
    if (result.result && result.result.ok === false) {
      throw new Error(result.result.error || `Instantly returned unsuccessful result: ${connectorAction}`);
    }
    return result.result;
  }

  analyzeSteps(steps = []) {
    const normalized = this.resolveItems(steps).map(step => ({
      step: step.step == null ? null : String(step.step),
      variant: step.variant == null ? null : String(step.variant),
      sent: this.number(step.sent),
      replies: this.number(step.replies),
      uniqueReplies: this.number(step.unique_replies),
      automaticReplies: this.number(step.unique_replies_automatic ?? step.replies_automatic),
      humanUniqueReplies: Math.max(
        0,
        this.number(step.unique_replies) -
          this.number(step.unique_replies_automatic ?? step.replies_automatic)
      ),
      opportunities: this.number(step.unique_opportunities ?? step.opportunities),
      meetingsBooked: this.number(step.meetings_booked),
      won: this.number(step.won)
    }));

    const firstStepReplies = normalized
      .filter(item => item.step === '1')
      .reduce((total, item) => total + item.humanUniqueReplies, 0);
    const followupReplies = normalized
      .filter(item => item.step !== null && item.step !== '1')
      .reduce((total, item) => total + item.humanUniqueReplies, 0);
    const totalHumanStepReplies = firstStepReplies + followupReplies;

    return {
      steps: normalized,
      firstStepReplies,
      followupReplies,
      followupReplyShare: this.ratio(followupReplies, totalHumanStepReplies),
      totalHumanStepReplies
    };
  }

  diagnoseCampaign(analytics = {}, overview = {}, stepSummary = {}) {
    const campaignId = analytics.campaign_id || overview.campaign_id || null;
    const campaignName = analytics.campaign_name || overview.campaign_name || campaignId || 'Unnamed Campaign';
    const contacted = this.number(overview.contacted_count ?? analytics.contacted_count);
    const sent = this.number(overview.emails_sent_count ?? analytics.emails_sent_count);
    const bounces = this.number(overview.bounced_count ?? analytics.bounced_count);
    const replies = this.humanReplies(analytics, overview);
    const interested = this.number(overview.total_interested);
    const meetingsBooked = this.number(overview.total_meeting_booked);
    const meetingsCompleted = this.number(overview.total_meeting_completed);
    const closed = this.number(overview.total_closed);
    const opportunities = this.number(overview.total_opportunities ?? analytics.total_opportunities);

    const bounceRate = this.ratio(bounces, contacted || sent);
    const replyRate = this.ratio(replies, contacted);
    const interestedPerReply = this.ratio(interested, replies);
    const meetingPerInterested = this.ratio(meetingsBooked, interested);
    const closedPerMeeting = this.ratio(closed, meetingsCompleted || meetingsBooked);

    let diagnosis = 'WATCH/OPTIMIZE';
    let priority = 40;
    let rationale = 'Campaign has enough activity to monitor but does not cross a stronger failure threshold.';
    let recommendedAction = 'Review trend by segment, copy, and step before scaling volume.';

    if (contacted < this.thresholds.minimumContacted) {
      diagnosis = 'INSUFFICIENT_DATA';
      priority = 20;
      rationale = `Only ${contacted} unique contacts have been reached; more data is needed for a stable diagnosis.`;
      recommendedAction = 'Do not make a major strategy change from this campaign yet; verify delivery and continue only if targeting is correct.';
    } else if (bounceRate !== null && bounceRate >= this.thresholds.highBounceRate) {
      diagnosis = 'DELIVERABILITY/LIST';
      priority = 100;
      rationale = `Bounce rate is ${(bounceRate * 100).toFixed(2)}%, above the ${(this.thresholds.highBounceRate * 100).toFixed(2)}% critical threshold.`;
      recommendedAction = 'Stop scaling this campaign. Re-verify the list, inspect sending-account vitals, domain reputation, and inbox placement first.';
    } else if (replyRate !== null && replyRate < this.thresholds.lowReplyRate) {
      diagnosis = 'DELIVERABILITY/TARGETING/MESSAGE';
      priority = 90;
      rationale = `Human reply rate is ${(replyRate * 100).toFixed(2)}%, below the ${(this.thresholds.lowReplyRate * 100).toFixed(2)}% floor.`;
      recommendedAction = 'Test inbox placement and account health, then tighten the segment and rewrite the first email around one observed company problem.';
    } else if (replies >= 5 && (interested + meetingsBooked + meetingsCompleted + closed + opportunities) === 0) {
      diagnosis = 'REPLY_HANDLING/CRM_CLASSIFICATION';
      priority = 82;
      rationale = `${replies} human replies are recorded but no downstream interest/opportunity/meeting/close events are recorded.`;
      recommendedAction = 'Audit reply classification and follow-up. Confirm positive replies are being tagged and converted into meeting asks instead of being lost in Unibox.';
    } else if (
      replies >= 5 && interestedPerReply !== null &&
      interestedPerReply < this.thresholds.lowInterestedPerReply
    ) {
      diagnosis = 'TARGETING/MESSAGE/OFFER';
      priority = 80;
      rationale = `Replies exist, but only ${(interestedPerReply * 100).toFixed(1)}% of human replies become interested records.`;
      recommendedAction = 'Narrow targeting and make the offer/problem statement more specific. Do not increase send volume until positive intent improves.';
    } else if (
      interested >= 3 && meetingPerInterested !== null &&
      meetingPerInterested < this.thresholds.lowMeetingPerInterested
    ) {
      diagnosis = 'CTA/MEETING_CONVERSION';
      priority = 75;
      rationale = `Only ${(meetingPerInterested * 100).toFixed(1)}% of interested records become booked meetings.`;
      recommendedAction = 'Simplify the CTA, shorten response time, and use a direct low-friction meeting ask with immediate follow-up.';
    } else if (
      meetingsBooked >= 3 && closedPerMeeting !== null &&
      closedPerMeeting < this.thresholds.lowClosedPerMeeting
    ) {
      diagnosis = 'SALES_CONVERSION';
      priority = 70;
      rationale = `Only ${(closedPerMeeting * 100).toFixed(1)}% of booked/completed meetings are recorded closed.`;
      recommendedAction = 'Audit qualification, discovery, proof, pricing, proposal speed, objections, and follow-up. The primary leak is after meetings are generated.';
    } else if (
      replyRate !== null && replyRate >= this.thresholds.healthyReplyRate &&
      (bounceRate === null || bounceRate < this.thresholds.highBounceRate)
    ) {
      diagnosis = 'HEALTHY/SCALE';
      priority = 10;
      rationale = `Human reply rate is ${(replyRate * 100).toFixed(2)}% with acceptable bounce performance.`;
      recommendedAction = 'Preserve the segment/message combination, validate downstream meeting/close quality, then scale cautiously.';
    }

    return {
      campaignId,
      campaignName,
      campaignStatus: analytics.campaign_status ?? null,
      diagnosis,
      priority,
      rationale,
      recommendedAction,
      funnel: {
        leads: this.number(analytics.leads_count),
        contacted,
        sent,
        bounces,
        humanReplies: replies,
        interested,
        opportunities,
        meetingsBooked,
        meetingsCompleted,
        closed
      },
      rates: {
        bounceRate,
        replyRate,
        interestedPerReply,
        meetingPerInterested,
        closedPerMeeting
      },
      sequence: stepSummary
    };
  }

  portfolioSummary(campaigns = [], providerOverview = {}) {
    const aggregate = campaigns.reduce(
      (result, campaign) => {
        for (const [key, value] of Object.entries(campaign.funnel || {})) {
          result[key] = (result[key] || 0) + this.number(value);
        }
        return result;
      },
      {}
    );

    const diagnosisCounts = {};
    for (const campaign of campaigns) {
      diagnosisCounts[campaign.diagnosis] = (diagnosisCounts[campaign.diagnosis] || 0) + 1;
    }

    return {
      campaignsAudited: campaigns.length,
      diagnosisCounts,
      aggregateFunnel: aggregate,
      aggregateRates: {
        bounceRate: this.ratio(aggregate.bounces, aggregate.contacted || aggregate.sent),
        replyRate: this.ratio(aggregate.humanReplies, aggregate.contacted),
        interestedPerReply: this.ratio(aggregate.interested, aggregate.humanReplies),
        meetingPerInterested: this.ratio(aggregate.meetingsBooked, aggregate.interested),
        closedPerMeeting: this.ratio(aggregate.closed, aggregate.meetingsCompleted || aggregate.meetingsBooked)
      },
      providerOverview: providerOverview || null,
      topPriority: campaigns.length > 0
        ? {
            campaignId: campaigns[0].campaignId,
            campaignName: campaigns[0].campaignName,
            diagnosis: campaigns[0].diagnosis,
            priority: campaigns[0].priority,
            recommendedAction: campaigns[0].recommendedAction
          }
        : null
    };
  }

  async generateAudit() {
    const startedAt = this.now();
    this.appendEvent('INSTANTLY_REVENUE_AUDIT_STARTED', { startedAt });

    const connectorLoad = this.runtime.loadAllConnectors();
    if (!connectorLoad.loadedConnectors || !connectorLoad.loadedConnectors.includes('INSTANTLY')) {
      throw new Error('INSTANTLY connector was not loaded by ConnectorRuntime.');
    }

    const errors = [];
    let analyticsItems = [];
    let providerOverview = null;

    try {
      const response = await this.executeInstantly('getCampaignAnalytics', {});
      analyticsItems = this.resolveItems(response?.analytics ?? response);
    } catch (error) {
      errors.push({ area: 'CAMPAIGN_ANALYTICS', error: error.message });
    }

    try {
      const response = await this.executeInstantly('getCampaignAnalyticsOverview', {});
      providerOverview = response?.analytics ?? response ?? null;
    } catch (error) {
      errors.push({ area: 'PORTFOLIO_OVERVIEW', error: error.message });
    }

    const campaigns = [];
    for (const analytics of analyticsItems) {
      const campaignId = analytics.campaign_id;
      if (!campaignId) {
        errors.push({ area: 'CAMPAIGN_ID', error: 'Campaign analytics record did not contain campaign_id.' });
        continue;
      }

      let overview = {};
      let steps = [];
      try {
        const response = await this.executeInstantly('getCampaignAnalyticsOverview', { id: campaignId });
        overview = response?.analytics ?? response ?? {};
      } catch (error) {
        errors.push({ campaignId, area: 'OVERVIEW', error: error.message });
      }

      try {
        const response = await this.executeInstantly('getCampaignStepsAnalytics', {
          campaign_id: campaignId,
          include_opportunities_count: true
        });
        steps = response?.analytics ?? response ?? [];
      } catch (error) {
        errors.push({ campaignId, area: 'STEPS', error: error.message });
      }

      const stepSummary = this.analyzeSteps(steps);
      campaigns.push(this.diagnoseCampaign(analytics, overview, stepSummary));
    }

    campaigns.sort((a, b) => b.priority - a.priority || b.funnel.contacted - a.funnel.contacted);

    const summary = this.portfolioSummary(campaigns, providerOverview);
    const audit = {
      ok: analyticsItems.length > 0 && errors.filter(item => item.area === 'CAMPAIGN_ANALYTICS').length === 0,
      service: this.service,
      version: this.version,
      readOnly: true,
      startedAt,
      completedAt: this.now(),
      thresholds: this.thresholds,
      summary,
      campaigns,
      errors
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const historicalJsonPath = path.join(this.reportDir, `Instantly_Revenue_Audit_${timestamp}.json`);
    const historicalMarkdownPath = path.join(this.reportDir, `Instantly_Revenue_Audit_${timestamp}.md`);
    const markdown = this.buildMarkdown(audit);

    this.atomicWrite(this.latestJsonPath, audit);
    this.atomicWrite(this.latestMarkdownPath, markdown);
    this.atomicWrite(historicalJsonPath, audit);
    this.atomicWrite(historicalMarkdownPath, markdown);

    this.appendEvent('INSTANTLY_REVENUE_AUDIT_COMPLETED', {
      ok: audit.ok,
      campaignsAudited: campaigns.length,
      errors: errors.length,
      topPriority: summary.topPriority
    });

    return audit;
  }

  buildMarkdown(audit) {
    const percent = value => value == null ? 'N/A' : `${(value * 100).toFixed(2)}%`;
    const summary = audit.summary;
    const rows = audit.campaigns.length > 0
      ? audit.campaigns.map(campaign =>
          `| ${String(campaign.campaignName).replace(/\|/g, '/')} | ${campaign.diagnosis} | ${campaign.funnel.contacted} | ${percent(campaign.rates.replyRate)} | ${percent(campaign.rates.bounceRate)} | ${campaign.funnel.interested} | ${campaign.funnel.meetingsBooked} | ${campaign.funnel.closed} | ${percent(campaign.sequence.followupReplyShare)} |`
        ).join('\n')
      : '| None | N/A | 0 | N/A | N/A | 0 | 0 | 0 | N/A |';

    const priorities = audit.campaigns.slice(0, 10).map((campaign, index) =>
      `${index + 1}. **${campaign.campaignName} — ${campaign.diagnosis}**\n   - ${campaign.rationale}\n   - Action: ${campaign.recommendedAction}`
    ).join('\n') || '- No campaigns were available to rank.';

    const errorLines = audit.errors.length > 0
      ? audit.errors.map(item => `- ${item.campaignId ? `${item.campaignId} / ` : ''}${item.area}: ${item.error}`).join('\n')
      : '- None';

    return `# MILES Instantly Revenue Audit\n\nGenerated: ${audit.completedAt}\n\n**Read-Only:** YES\n\n## Portfolio Funnel\n\n| Metric | Value |\n|---|---:|\n| Campaigns Audited | ${summary.campaignsAudited} |\n| Unique Contacts | ${summary.aggregateFunnel.contacted || 0} |\n| Emails Sent | ${summary.aggregateFunnel.sent || 0} |\n| Human Replies | ${summary.aggregateFunnel.humanReplies || 0} |\n| Reply Rate | ${percent(summary.aggregateRates.replyRate)} |\n| Bounces | ${summary.aggregateFunnel.bounces || 0} |\n| Bounce Rate | ${percent(summary.aggregateRates.bounceRate)} |\n| Interested | ${summary.aggregateFunnel.interested || 0} |\n| Meetings Booked | ${summary.aggregateFunnel.meetingsBooked || 0} |\n| Meetings Completed | ${summary.aggregateFunnel.meetingsCompleted || 0} |\n| Closed | ${summary.aggregateFunnel.closed || 0} |\n\n## Campaign Diagnosis\n\n| Campaign | Diagnosis | Contacted | Human Reply Rate | Bounce Rate | Interested | Meetings | Closed | Follow-up Reply Share |\n|---|---|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Revenue Priorities\n\n${priorities}\n\n## Errors\n\n${errorLines}\n`;
  }

  async healthCheck() {
    try {
      const connectorLoad = this.runtime.loadAllConnectors();
      const instantlyLoaded = Array.isArray(connectorLoad.loadedConnectors) &&
        connectorLoad.loadedConnectors.includes('INSTANTLY');
      return {
        ok: instantlyLoaded,
        service: this.service,
        version: this.version,
        status: instantlyLoaded ? 'HEALTHY' : 'DEGRADED',
        readOnly: true,
        generatedAt: this.now()
      };
    } catch (error) {
      return {
        ok: false,
        service: this.service,
        version: this.version,
        status: 'DEGRADED',
        readOnly: true,
        error: error.message,
        generatedAt: this.now()
      };
    }
  }
}

module.exports = InstantlyRevenueAuditService;
module.exports.InstantlyRevenueAuditService = InstantlyRevenueAuditService;
module.exports.default = InstantlyRevenueAuditService;
