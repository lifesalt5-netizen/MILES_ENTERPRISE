"use strict";

const RevenueMeetingInventoryService = require("./RevenueMeetingInventoryService");

function now() {
  return new Date().toISOString();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusText(value) {
  return String(value || "").trim().toLowerCase();
}

class RevenueCOOService {
  constructor(options = {}) {
    this.bounceWarningRate = number(options.bounceWarningRate, 0.03);
    this.minimumActiveCampaigns = number(options.minimumActiveCampaigns, 2);
    this.meetingInventory =
      options.meetingInventory ||
      new RevenueMeetingInventoryService({
        root: options.root
      });
  }

  analyze(executiveState = {}, cycleId = null) {
    const business = executiveState.business || {};
    const marketing = executiveState.marketing || {};
    const campaigns = Array.isArray(business.campaigns) ? business.campaigns : [];
    const replies = Array.isArray(business.replies) ? business.replies : [];
    const deals = Array.isArray(business.deals) ? business.deals : [];
    const mailboxes = Array.isArray(business.mailboxes)
      ? business.mailboxes
      : Array.isArray(marketing.mailboxes)
        ? marketing.mailboxes
        : [];
    const segments = Array.isArray(business.segments)
      ? business.segments
      : Array.isArray(marketing.segments)
        ? marketing.segments
        : [];

    const meetingInventory = this.meetingInventory.read();

    const activeCampaigns = campaigns.filter(c =>
      /active|running|enabled|launched/.test(statusText(c.status))
    );
    const pausedCampaigns = campaigns.filter(c =>
      /paused|stopped|disabled|error|failed/.test(statusText(c.status))
    );
    const positiveReplies = replies.filter(r =>
      /positive|interested|meeting|booked|qualified/.test(
        statusText(r.classification || r.category || r.status || r.intent)
      )
    );
    const unclassifiedReplies = replies.filter(r =>
      !String(r.classification || r.category || r.intent || "").trim()
    );
    const unhealthyMailboxes = mailboxes.filter(m =>
      /warning|critical|failed|disconnected|paused|unhealthy/.test(
        statusText(m.health || m.status)
      )
    );
    const depletedSegments = segments.filter(s => {
      const remaining = number(
        s.verifiedRemaining ?? s.remaining ?? s.availableLeads ?? s.leadsRemaining,
        -1
      );
      return remaining === 0 || /depleted|exhausted|complete/.test(statusText(s.status));
    });

    const totalSent = campaigns.reduce(
      (sum, c) => sum + number(c.sent ?? c.emailsSent ?? c.totalSent),
      0
    );
    const totalBounces = campaigns.reduce(
      (sum, c) => sum + number(c.bounces ?? c.bounced ?? c.totalBounces),
      0
    );
    const bounceRate = totalSent > 0 ? totalBounces / totalSent : 0;

    const missions = [];

    if (meetingInventory.ok && meetingInventory.upcomingMeetings === 0) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: "Restore qualified P2GC meeting inventory",
        objective: "Generate upcoming qualified Federal Strategy calls for P2GC",
        reason:
          `Calendly revenue pipeline is healthy but currently shows 0 upcoming P2GC meetings; ` +
          `${meetingInventory.pastActiveMeetings} prior active meeting(s) and ` +
          `${meetingInventory.canceledMeetings} canceled meeting(s) are visible.`,
        recommendedAction:
          "Run the meeting-generation recovery sequence: prioritize CURRENTLY_LOOKING_FOR_HELP first, then Expired Everything, Expiring 6M, Expiring 12M, GSA, VA, SAM, Certifications, and SBS; refresh Instantly campaign/reply/mailbox capacity; identify verified highest-intent prospects; prepare the next safe outbound and follow-up actions; preserve suppression/deduplication rules; do not enable Instantly mutations outside existing controlled-write governance; track every resulting booking back to segment and campaign when attribution evidence exists.",
        expectedImpact:
          "Refills the qualified meeting calendar and converts outbound activity into the primary P2GC revenue KPI.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider",
        metadata: {
          trigger: "ZERO_UPCOMING_P2GC_MEETINGS",
          source: "CalendlyRevenuePipeline",
          meetingInventory,
          targetSegmentOrder: [
            "CURRENTLY_LOOKING_FOR_HELP",
            "EXPIRED_EVERYTHING",
            "EXPIRING_6M",
            "EXPIRING_12M",
            "GSA",
            "VA",
            "SAM",
            "CERTIFICATIONS",
            "SBS"
          ],
          instantlyMutationPolicy: "EXISTING_CONTROLLED_WRITE_GOVERNANCE_ONLY"
        }
      });
    }

    if (unclassifiedReplies.length > 0) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: `Classify ${unclassifiedReplies.length} unclassified outbound repl${unclassifiedReplies.length === 1 ? "y" : "ies"}`,
        objective: "Classify Instantly replies and create the correct follow-up actions",
        reason: `${unclassifiedReplies.length} reply record(s) do not have a usable classification.`,
        recommendedAction: "Classify each reply as Positive, Neutral, Negative, or Technical; create follow-up work for positive and neutral replies.",
        expectedImpact: "Protects response speed and prevents qualified prospects from being lost.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (positiveReplies.length > 0) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: `Advance ${positiveReplies.length} positive outbound repl${positiveReplies.length === 1 ? "y" : "ies"}`,
        objective: "Create immediate next actions for positive Instantly replies",
        reason: `${positiveReplies.length} positive or meeting-intent reply record(s) are present.`,
        recommendedAction: "Prepare personalized responses, scheduling actions, CRM updates, and CEO approval only for protected commitments.",
        expectedImpact: "Moves active prospects toward scheduled calls and revenue.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (bounceRate >= this.bounceWarningRate) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: "Protect outbound deliverability",
        objective: "Audit Instantly bounce risk and stop unsafe sending conditions",
        reason: `Observed aggregate bounce rate is ${(bounceRate * 100).toFixed(2)}%.`,
        recommendedAction: "Audit campaign-level bounces, isolate the affected list or inboxes, and prepare a safe remediation action before additional sending.",
        expectedImpact: "Protects sending domains and inbox reputation.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (unhealthyMailboxes.length > 0) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: `Repair ${unhealthyMailboxes.length} unhealthy outbound mailbox${unhealthyMailboxes.length === 1 ? "" : "es"}`,
        objective: "Restore safe Instantly mailbox capacity",
        reason: `${unhealthyMailboxes.length} mailbox record(s) show a warning or failed state.`,
        recommendedAction: "Audit authentication, connection, warmup, sending limits, and recent bounce behavior; auto-repair safe settings and escalate credential or purchasing needs.",
        expectedImpact: "Restores outbound capacity without risking infrastructure.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (campaigns.length > 0 && activeCampaigns.length < this.minimumActiveCampaigns) {
      missions.push({
        priority: 2,
        area: "Revenue Operations",
        title: "Restore minimum outbound campaign coverage",
        objective: "Audit paused Instantly campaigns and prepare the next safe campaign action",
        reason: `Only ${activeCampaigns.length} active campaign(s) were detected from ${campaigns.length} total campaign(s).`,
        recommendedAction: "Determine whether paused campaigns can safely resume and identify the next verified segment and available inbox capacity.",
        expectedImpact: "Maintains consistent lead generation and pipeline creation.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (depletedSegments.length > 0) {
      missions.push({
        priority: 2,
        area: "Revenue Operations",
        title: `Replace ${depletedSegments.length} depleted outbound segment${depletedSegments.length === 1 ? "" : "s"}`,
        objective: "Select and prepare the next verified outreach segment",
        reason: `${depletedSegments.length} segment record(s) appear depleted or exhausted.`,
        recommendedAction: "Select the next eligible verified segment, confirm deduplication and suppression rules, then prepare upload and campaign mapping.",
        expectedImpact: "Prevents campaign downtime and keeps outbound capacity productive.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (campaigns.length === 0) {
      missions.push({
        priority: 2,
        area: "Revenue Operations",
        title: "Establish live outbound campaign visibility",
        objective: "Refresh Instantly campaigns, inboxes, segments, and reply state",
        reason: "No campaign records are available in the current executive business state.",
        recommendedAction: "Use the Instantly connector to refresh live campaign, mailbox, reply, and capacity metrics before planning outbound actions.",
        expectedImpact: "Gives MILES the live state required to operate outbound autonomously.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    return {
      ok: true,
      type: "REVENUE_COO_ANALYSIS",
      generatedAt: now(),
      cycleId,
      metrics: {
        campaignsTotal: campaigns.length,
        campaignsActive: activeCampaigns.length,
        campaignsPausedOrFailed: pausedCampaigns.length,
        repliesTotal: replies.length,
        repliesPositive: positiveReplies.length,
        repliesUnclassified: unclassifiedReplies.length,
        dealsTotal: deals.length,
        mailboxesTotal: mailboxes.length,
        mailboxesUnhealthy: unhealthyMailboxes.length,
        segmentsTotal: segments.length,
        segmentsDepleted: depletedSegments.length,
        sentObserved: totalSent,
        bouncesObserved: totalBounces,
        bounceRate,
        meetingPipelineStatus: meetingInventory.status,
        p2gcMeetingEvents: meetingInventory.p2gcEvents,
        meetingsActive: meetingInventory.activeMeetings,
        meetingsUpcoming: meetingInventory.upcomingMeetings,
        meetingsPastActive: meetingInventory.pastActiveMeetings,
        meetingsCanceled: meetingInventory.canceledMeetings
      },
      meetingInventory,
      missions,
      requiresKevin: false
    };
  }
}

module.exports = RevenueCOOService;
