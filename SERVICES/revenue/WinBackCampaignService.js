"use strict";

const fs = require("fs");
const path = require("path");

const PRIOR_CAMPAIGN_KEY = "P2GC_WINBACK_PRIOR_CONVERSATIONS_2026Q3";
const PRIOR_CAMPAIGN_NAME = "P2GC Win-Back — Prior Conversations";
const REACTIVATION_CAMPAIGN_KEY = "P2GC_WINBACK_NO_SHOW_REACTIVATION_2026Q3";
const REACTIVATION_CAMPAIGN_NAME = "P2GC Win-Back — No-Show & Reschedule Reactivation";
const BLUEPRINT_NAME = "Executive Government Growth Blueprint™";
const BLUEPRINT_PRICE = 2500;
const ACCELERATOR_NAME = "Government Growth Accelerator™";
const ACCELERATOR_MRR = 1250;
const MAX_AUDIENCE_PER_TRACK = 500;

const TRACKS = Object.freeze({
  PRIOR_CONVERSATION: "PRIOR_CONVERSATION",
  REACTIVATION: "REACTIVATION"
});

const SUPPRESSED_STATUSES = [
  /\bCLIENT\b/i,
  /\bCUSTOMER\b/i,
  /ACTIVE[_ -]?CLIENT/i,
  /PAID[_ -]?CLIENT/i,
  /CURRENT[_ -]?CLIENT/i,
  /CLOSED[_ -]?WON/i,
  /\bWON\b/i,
  /UNSUBSCRIB/i,
  /DO[_ -]?NOT[_ -]?CONTACT/i,
  /\bDNC\b/i,
  /BOUNC/i,
  /NEGATIVE/i,
  /DISQUALIF/i,
  /ACTIVE[_ -]?PROSPECT/i,
  /OPEN[_ -]?OPPORTUNITY/i,
  /MEETING[_ -]?BOOKED/i,
  /CALL[_ -]?SCHEDULED/i,
  /PROPOSAL[_ -]?(SENT|PENDING|OPEN)?/i,
  /\bENGAGED\b/i,
  /NEGOTIAT/i
];

const FUNNEL_STAGES = Object.freeze([
  "WINBACK_IDENTIFIED",
  "ENROLLED",
  "REPLIED_POSITIVE",
  "REENGAGED_MEETING",
  "BLUEPRINT_DEMO",
  "PROPOSAL_SENT",
  "WON",
  "ACCELERATOR_WON"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function validEmail(value) {
  return /^\S+@\S+\.\S+$/.test(clean(value));
}

function hasPlaceholder(value) {
  return /\{\{|\}\}|\bunknown\b|\btbd\b|\bn\/a\b/i.test(clean(value));
}

function statusSuppressed(value) {
  return SUPPRESSED_STATUSES.some(pattern => pattern.test(clean(value)));
}

function pct(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

class WinBackCampaignService {
  constructor(options = {}) {
    this.service = "P2GC_WINBACK_CAMPAIGN";
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.connector = options.connector || null;
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.reportPath = options.reportPath || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "winback",
      "campaign_latest.json"
    );
  }

  getConnector() {
    if (this.connector) return this.connector;
    return require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "connector.js"));
  }

  campaignMeta(track) {
    if (track === TRACKS.REACTIVATION) {
      return {
        track,
        key: REACTIVATION_CAMPAIGN_KEY,
        name: REACTIVATION_CAMPAIGN_NAME,
        maxAudience: MAX_AUDIENCE_PER_TRACK
      };
    }
    return {
      track: TRACKS.PRIOR_CONVERSATION,
      key: PRIOR_CAMPAIGN_KEY,
      name: PRIOR_CAMPAIGN_NAME,
      maxAudience: MAX_AUDIENCE_PER_TRACK
    };
  }

  priorConversationSequence() {
    return [
      {
        day: 1,
        delay: 0,
        subject: "{{first_name}}, wanted to revisit our GovCon conversation",
        body: `{{first_name}},\n\nWe spoke in {{prior_month}} about {{prior_topic}}.\n\nI wanted to circle back because P2GC has changed substantially since then. We now start with a current, company-specific ${BLUEPRINT_NAME} powered by our ORION intelligence workflow—not a generic service menu.\n\nIt shows where {{company_display}} stands now: agency/buyer alignment, vehicles and gaps, competitors and incumbents, prime/team targets, live and forecast opportunities, recompetes, and the highest-priority next actions.\n\nIf federal growth is still a priority, I'll refresh {{company_display}} before we talk and show you what has changed since our last conversation.\n\nWorth 15 minutes?\n\nKevin Carter\nPathways 2 Government Contracting\nFrom Eligibility to Awards — We Build the Entire Pathway.`
      },
      {
        day: 4,
        delay: 3,
        subject: "What I would look at first for {{company_display}}",
        body: `{{first_name}},\n\nRather than restart our old conversation from scratch, I would begin with what is true today:\n\n- where federal dollars are actually moving in your market,\n- which agencies and buyers fit best,\n- whether your current vehicles help or constrain you,\n- live opportunities, forecasts and upcoming recompetes,\n- primes/team partners worth approaching, and\n- the specific gaps keeping good opportunities from becoming realistic pursuits.\n\nThe point is to put a current decision picture on the screen quickly.\n\nIf you'd like, send me the one federal growth issue that matters most right now and I'll focus the refresh there.\n\nKevin`
      },
      {
        day: 8,
        delay: 4,
        subject: "A lower-friction way to restart",
        body: `{{first_name}},\n\nIf timing, budget or uncertainty was part of why we didn't move forward before, I've simplified the entry point.\n\nWe can start with the ${BLUEPRINT_NAME} at $${BLUEPRINT_PRICE.toLocaleString()} and use it to determine whether there is a real, evidence-backed growth pathway before committing to ongoing support.\n\nIf ongoing execution makes sense after that, the ${ACCELERATOR_NAME} starts at $${ACCELERATOR_MRR.toLocaleString()}/month.\n\nNo need to rehash everything from the beginning. I can pick up from our prior conversation and show you the current picture.\n\nOpen to a short reconnect?\n\nKevin`
      },
      {
        day: 14,
        delay: 6,
        subject: "Should I close this out?",
        body: `{{first_name}},\n\nI'll close the loop after this.\n\nWe spoke before about federal growth, and I reached back out because P2GC can now show you a much more complete, current picture of where {{company_display}} can realistically grow and what to do next.\n\nIf it's still a priority, reply with "revisit" and I'll pick it back up.\n\nIf not, no problem—I won't keep chasing you.\n\nKevin`
      }
    ];
  }

  reactivationSequence() {
    return [
      {
        day: 1,
        delay: 0,
        subject: "Still working on federal growth?",
        body: `{{first_name}},\n\nYou had scheduled a federal strategy call with me in {{prior_month}}, but we never got a chance to connect.\n\nI wanted to reach back out because P2GC has expanded substantially since then. We now use a company-specific ${BLUEPRINT_NAME} to show agency/buyer alignment, vehicle gaps, competitors, primes/team partners, live and forecast opportunities, recompetes, and the highest-priority path forward.\n\nIf government contracting growth is still on your list, I'd be glad to refresh {{company_display}} and show you the current picture in 15 minutes.\n\nStill relevant?\n\nKevin Carter\nPathways 2 Government Contracting`
      },
      {
        day: 5,
        delay: 4,
        subject: "What changed at P2GC since you booked",
        body: `{{first_name}},\n\nOne reason I'm following up: the conversation is very different now from a generic GovCon consultation.\n\nWe can put current intelligence on the screen for {{company_display}}—best-fit agencies, vehicles/gaps, competitive position, primes, current and forecast opportunities, recompetes and the next 30/60/90-day priorities.\n\nYou don't need to prepare anything. If federal growth is still a goal, I can do the homework before the call.\n\nWant to reconnect?\n\nKevin`
      },
      {
        day: 12,
        delay: 7,
        subject: "Close this out?",
        body: `{{first_name}},\n\nI'll make this my last note.\n\nYou had tried to connect with P2GC before, so I wanted to give you one more chance to revisit it now that the service and intelligence behind it are much stronger.\n\nIf federal growth is still a priority, reply "yes" and I'll send you a time. If not, I'll close it out.\n\nKevin`
      }
    ];
  }

  sequence(track) {
    return track === TRACKS.REACTIVATION
      ? this.reactivationSequence()
      : this.priorConversationSequence();
  }

  getCampaignDefinition(track) {
    const meta = this.campaignMeta(track);
    return {
      ...meta,
      offers: {
        entry: { name: BLUEPRINT_NAME, price: BLUEPRINT_PRICE },
        recurring: { name: ACCELERATOR_NAME, monthlyPrice: ACCELERATOR_MRR }
      },
      funnelStages: [...FUNNEL_STAGES],
      safeguards: {
        currentClientsSuppressed: true,
        activePipelineSuppressed: true,
        unsubscribesAndDncSuppressed: true,
        noShowTrackClaimsPriorConversation: false,
        activationRequiresExplicitApproval: true
      },
      sequence: this.sequence(track)
    };
  }

  qualifyLead(lead = {}, track = TRACKS.PRIOR_CONVERSATION) {
    const blockers = [];
    const email = clean(lead.email);
    const firstName = clean(lead.first_name || lead.firstName);
    const relationshipStatus = clean(lead.relationship_status).toUpperCase();
    const leadTrack = clean(lead.track).toUpperCase();
    const crmStatus = clean(lead.crm_status || lead.status || lead.lead_status).toUpperCase();
    const priorMonth = clean(lead.prior_month);
    const companyDisplay = clean(lead.company_display || lead.company || "your company");
    const priorTopic = clean(lead.prior_topic || "your federal growth strategy");

    if (!validEmail(email)) blockers.push("VALID_EMAIL_REQUIRED");
    if (!firstName || hasPlaceholder(firstName)) blockers.push("FIRST_NAME_REQUIRED");
    if (!priorMonth || hasPlaceholder(priorMonth)) blockers.push("PRIOR_MONTH_REQUIRED");
    if (!companyDisplay || hasPlaceholder(companyDisplay)) blockers.push("COMPANY_DISPLAY_REQUIRED");
    if (statusSuppressed(crmStatus)) blockers.push(`SUPPRESSED_STATUS:${crmStatus}`);
    if (lead.unsubscribed === true || lead.do_not_contact === true) blockers.push("DO_NOT_CONTACT");
    if (lead.blockers && Array.isArray(lead.blockers) && lead.blockers.length) {
      blockers.push(...lead.blockers.map(item => `UPSTREAM:${clean(item)}`));
    }

    if (track === TRACKS.PRIOR_CONVERSATION) {
      if (leadTrack && leadTrack !== TRACKS.PRIOR_CONVERSATION) blockers.push(`TRACK_MISMATCH:${leadTrack}`);
      if (!["PRIOR_CONVERSATION", "COMPLETED"].includes(relationshipStatus)) {
        blockers.push(`PRIOR_CONVERSATION_NOT_CONFIRMED:${relationshipStatus || "EMPTY"}`);
      }
    } else {
      if (leadTrack && leadTrack !== TRACKS.REACTIVATION) blockers.push(`TRACK_MISMATCH:${leadTrack}`);
      if (!['NO_SHOW', 'RESCHEDULED_UNCONFIRMED'].includes(relationshipStatus)) {
        blockers.push(`REACTIVATION_STATUS_NOT_CONFIRMED:${relationshipStatus || "EMPTY"}`);
      }
    }

    return {
      eligible: blockers.length === 0,
      email,
      track,
      personalization: {
        first_name: firstName,
        company: clean(lead.company),
        company_display: companyDisplay,
        prior_month: priorMonth,
        prior_topic: priorTopic,
        prior_relationship: relationshipStatus,
        prior_meeting_date: clean(lead.meeting_date)
      },
      blockers: [...new Set(blockers)]
    };
  }

  prepareAudience(candidates = [], track = TRACKS.PRIOR_CONVERSATION, options = {}) {
    const meta = this.campaignMeta(track);
    const cap = Math.min(meta.maxAudience, Math.max(1, Number(options.maxAudience || meta.maxAudience)));
    const deduped = new Map();
    for (const lead of Array.isArray(candidates) ? candidates : []) {
      const email = clean(lead.email).toLowerCase();
      const key = email || `${clean(lead.full_name || lead.first_name).toUpperCase()}|${clean(lead.meeting_date)}`;
      if (!deduped.has(key)) deduped.set(key, lead);
    }

    const evaluated = [...deduped.values()].map((lead, index) => ({
      index,
      lead,
      qualification: this.qualifyLead(lead, track)
    }));
    const eligible = evaluated.filter(item => item.qualification.eligible).slice(0, cap);
    const blocked = evaluated.filter(item => !item.qualification.eligible);

    return {
      evaluated: evaluated.length,
      eligibleCount: eligible.length,
      blockedCount: blocked.length,
      capped: evaluated.filter(item => item.qualification.eligible).length > cap,
      cap,
      eligible,
      blocked
    };
  }

  buildCampaignPayload(track, options = {}) {
    const meta = this.campaignMeta(track);
    const timezone = clean(options.timezone || process.env.P2GC_OUTBOUND_TIMEZONE || "America/New_York");
    const sendFrom = clean(options.sendFrom || "09:00");
    const sendTo = clean(options.sendTo || "16:30");
    const sequence = this.sequence(track);

    return {
      name: options.name || meta.name,
      campaign_schedule: {
        schedules: [
          {
            name: "P2GC Win-Back Weekdays",
            timing: { from: sendFrom, to: sendTo },
            days: { "0": true, "1": true, "2": true, "3": true, "4": true, "5": false, "6": false },
            timezone
          }
        ]
      },
      sequences: [
        {
          steps: sequence.map(step => ({
            type: "email",
            delay: step.delay,
            delay_unit: "days",
            variants: [
              {
                subject: step.subject,
                body: step.body,
                v_disabled: false
              }
            ]
          }))
        }
      ],
      text_only: true,
      first_email_text_only: true,
      link_tracking: false,
      open_tracking: false,
      stop_on_reply: true,
      stop_on_auto_reply: true,
      daily_limit: Math.max(1, Number(options.dailyLimit || 20)),
      daily_max_leads: Math.max(1, Number(options.dailyMaxLeads || 20)),
      prioritize_new_leads: false,
      allow_risky_contacts: false,
      disable_bounce_protect: false,
      limit_emails_per_company_override: {
        mode: "custom",
        daily_limit: 1,
        scope: "per_campaign"
      },
      custom_variables: {
        first_name: "",
        company: "",
        company_display: "",
        prior_month: "",
        prior_topic: "",
        prior_relationship: "",
        prior_meeting_date: ""
      }
    };
  }

  buildLeadPayload(item, campaignId, track) {
    const lead = item.lead;
    const vars = item.qualification.personalization;
    const meta = this.campaignMeta(track);
    return {
      campaign: campaignId,
      email: item.qualification.email,
      first_name: vars.first_name,
      last_name: clean(lead.last_name || lead.lastName),
      company_name: clean(lead.company),
      website: clean(lead.website || lead.domain),
      job_title: clean(lead.job_title || lead.title),
      phone: clean(lead.phone),
      personalization: track === TRACKS.PRIOR_CONVERSATION
        ? `Prior P2GC conversation: ${vars.prior_month}`
        : `Prior P2GC booking not completed: ${vars.prior_month}`,
      skip_if_in_workspace: false,
      skip_if_in_campaign: true,
      verify_leads_on_import: true,
      custom_variables: {
        ...vars,
        campaign_key: meta.key,
        winback_track: track,
        source: clean(lead.source || "WINBACK_RECONSTRUCTION")
      }
    };
  }

  extractCampaignId(result = {}) {
    return clean(
      result?.result?.result?.id ||
      result?.result?.result?.campaign?.id ||
      result?.result?.result?.campaignId ||
      result?.result?.id ||
      result?.result?.campaign?.id ||
      result?.data?.id ||
      result?.id
    );
  }

  summarizeFunnel(events = []) {
    const counts = Object.fromEntries(FUNNEL_STAGES.map(stage => [stage, 0]));
    let wonRevenue = 0;
    let acceleratorMrr = 0;
    for (const event of Array.isArray(events) ? events : []) {
      const stage = clean(event.stage || event.eventType || event.status).toUpperCase();
      if (Object.prototype.hasOwnProperty.call(counts, stage)) counts[stage] += 1;
      if (stage === "WON") wonRevenue += Number(event.revenue || BLUEPRINT_PRICE);
      if (stage === "ACCELERATOR_WON") acceleratorMrr += Number(event.mrr || ACCELERATOR_MRR);
    }
    return {
      counts,
      conversions: {
        identifiedToEnrolledPct: pct(counts.ENROLLED, counts.WINBACK_IDENTIFIED),
        enrolledToPositiveReplyPct: pct(counts.REPLIED_POSITIVE, counts.ENROLLED),
        positiveReplyToMeetingPct: pct(counts.REENGAGED_MEETING, counts.REPLIED_POSITIVE),
        meetingToDemoPct: pct(counts.BLUEPRINT_DEMO, counts.REENGAGED_MEETING),
        demoToProposalPct: pct(counts.PROPOSAL_SENT, counts.BLUEPRINT_DEMO),
        proposalToWonPct: pct(counts.WON, counts.PROPOSAL_SENT)
      },
      wonRevenue,
      acceleratorMrr
    };
  }

  async executeTrack(track, candidates, input = {}) {
    const meta = this.campaignMeta(track);
    const audience = this.prepareAudience(candidates, track, input);
    const report = {
      ok: audience.eligibleCount > 0,
      track,
      campaignKey: meta.key,
      campaignName: meta.name,
      mode: input.apply === true ? "APPLY" : "PLAN_ONLY",
      status: audience.eligibleCount > 0 ? "READY" : "BLOCKED_NO_ELIGIBLE_LEADS",
      definition: this.getCampaignDefinition(track),
      audience: {
        evaluated: audience.evaluated,
        eligibleCount: audience.eligibleCount,
        blockedCount: audience.blockedCount,
        capped: audience.capped,
        cap: audience.cap,
        blocked: audience.blocked.map(item => ({
          email: item.qualification.email,
          name: clean(item.lead.full_name || item.lead.first_name),
          blockers: item.qualification.blockers
        }))
      },
      campaignPayload: this.buildCampaignPayload(track, input),
      campaignCreated: false,
      leadsUploaded: 0,
      campaignActivated: false
    };

    if (audience.eligibleCount === 0 || input.apply !== true) return report;

    const connector = this.getConnector();
    const campaignResult = await connector.execute({
      action: "createCampaign",
      payload: report.campaignPayload
    }, { reason: meta.key });
    report.campaignResult = campaignResult;
    const campaignId = this.extractCampaignId(campaignResult);
    report.campaignId = campaignId || null;

    if (!campaignId) {
      report.ok = Boolean(campaignResult?.ok);
      report.status = campaignResult?.result?.dryRun === true
        ? "INSTANTLY_DRY_RUN_CAMPAIGN_NOT_CREATED"
        : "CAMPAIGN_ID_NOT_RETURNED";
      return report;
    }

    report.campaignCreated = true;
    const leads = audience.eligible.map(item => this.buildLeadPayload(item, campaignId, track));
    const uploadResult = await connector.execute({
      action: "uploadLeads",
      payload: { campaignId, leads }
    }, { reason: meta.key });
    report.uploadResult = uploadResult;
    report.leadsUploaded = Number(uploadResult?.uploaded || uploadResult?.result?.uploaded || 0);

    if (input.activate === true) {
      const requiredApproval = `ACTIVATE:${meta.key}`;
      const suppliedApproval = clean(
        track === TRACKS.REACTIVATION
          ? input.reactivationActivationApproval || input.activationApproval
          : input.priorActivationApproval || input.activationApproval
      );
      if (suppliedApproval !== requiredApproval) {
        report.ok = false;
        report.status = "ACTIVATION_APPROVAL_REQUIRED";
        report.activationRequired = requiredApproval;
      } else {
        const activationResult = await connector.execute({
          action: "activateCampaign",
          payload: { campaignId }
        }, { reason: `${meta.key}:CEO_APPROVED` });
        report.activationResult = activationResult;
        report.campaignActivated = Boolean(activationResult?.ok && activationResult?.result?.dryRun !== true);
        report.status = report.campaignActivated ? "CAMPAIGN_ACTIVATED" : "CAMPAIGN_PREPARED_NOT_ACTIVATED";
      }
    } else {
      report.status = "CAMPAIGN_PREPARED_DRAFT";
    }

    return report;
  }

  writeReport(report) {
    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    const temp = `${this.reportPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(report, null, 2), "utf8");
    fs.renameSync(temp, this.reportPath);
    return this.reportPath;
  }

  async execute(input = {}) {
    const priorCandidates = input.priorConversationCandidates || [];
    const reactivationCandidates = input.reactivationCandidates || [];
    const prior = await this.executeTrack(TRACKS.PRIOR_CONVERSATION, priorCandidates, input);
    const reactivation = await this.executeTrack(TRACKS.REACTIVATION, reactivationCandidates, input);
    const report = {
      ok: prior.ok || reactivation.ok,
      service: this.service,
      generatedAt: this.generatedAt(),
      mode: input.apply === true ? "APPLY" : "PLAN_ONLY",
      prior,
      reactivation,
      funnel: this.summarizeFunnel(input.events || []),
      activationPolicy: "DRAFT_BY_DEFAULT_EXPLICIT_APPROVAL_REQUIRED"
    };
    if (input.writeReport !== false) report.artifact = this.writeReport(report);
    return report;
  }
}

module.exports = WinBackCampaignService;
module.exports.WinBackCampaignService = WinBackCampaignService;
module.exports.constants = {
  PRIOR_CAMPAIGN_KEY,
  PRIOR_CAMPAIGN_NAME,
  REACTIVATION_CAMPAIGN_KEY,
  REACTIVATION_CAMPAIGN_NAME,
  BLUEPRINT_NAME,
  BLUEPRINT_PRICE,
  ACCELERATOR_NAME,
  ACCELERATOR_MRR,
  MAX_AUDIENCE_PER_TRACK,
  TRACKS,
  FUNNEL_STAGES
};
