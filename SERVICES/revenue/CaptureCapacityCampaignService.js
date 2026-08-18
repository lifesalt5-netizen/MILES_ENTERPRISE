"use strict";

const fs = require("fs");
const path = require("path");

const CAMPAIGN_KEY = "P2GC_CAPTURE_CAPACITY_2026Q3";
const CAMPAIGN_NAME = "P2GC Fractional Capture Intelligence — Trigger Qualified";
const SPRINT_NAME = "P2GC Capture Intelligence Sprint™";
const DESK_NAME = "Fractional Capture Intelligence Desk™";
const SPRINT_PRICE = 2500;
const DESK_MONTHLY_PRICE = 5000;
const MAX_AUDIENCE = 2000;
const TRIGGER_THRESHOLD = 4;

const REQUIRED_PERSONALIZATION = Object.freeze([
  "first_name",
  "company",
  "specific_current_need",
  "specific_company_problem_or_vehicle",
  "vehicle_or_market",
  "specific_capture_problem"
]);

const TRIGGER_WEIGHTS = Object.freeze({
  CAPTURE_HIRING: 5,
  BD_CAPTURE_OPENING: 5,
  RECENT_IDIQ_GWAC: 4,
  NEW_CONTRACT_VEHICLE: 4,
  AGENCY_EXPANSION: 4,
  MULTIPLE_RECOMPETES: 4,
  FEDERAL_AWARD_GROWTH: 3,
  ACQUISITION: 3
});

const SUPPRESSED_STATUSES = new Set([
  "UNSUBSCRIBED",
  "BOUNCED",
  "NEGATIVE",
  "DO_NOT_CONTACT",
  "DISQUALIFIED",
  "MEETING_BOOKED",
  "CLIENT",
  "CUSTOMER",
  "ACTIVE_CLIENT"
]);

const FUNNEL_STAGES = Object.freeze([
  "TARGETED",
  "ENROLLED",
  "REPLIED_POSITIVE",
  "MEETING_BOOKED",
  "SPRINT_WON",
  "DESK_WON"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function hasPlaceholder(value) {
  return /\{\{|\}\}|\bunknown\b|\btbd\b|\bn\/a\b/i.test(clean(value));
}

function pct(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

class CaptureCapacityCampaignService {
  constructor(options = {}) {
    this.service = "CAPTURE_CAPACITY_CAMPAIGN";
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
      "capture_capacity_campaign_latest.json"
    );
  }

  getConnector() {
    if (this.connector) return this.connector;
    return require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "connector.js"));
  }

  getCampaignDefinition() {
    return {
      campaignKey: CAMPAIGN_KEY,
      campaignName: CAMPAIGN_NAME,
      audiencePolicy: {
        mode: "TRIGGER_QUALIFIED_ONLY",
        triggerThreshold: TRIGGER_THRESHOLD,
        maxAudience: MAX_AUDIENCE,
        requiredPersonalization: [...REQUIRED_PERSONALIZATION],
        suppressedStatuses: [...SUPPRESSED_STATUSES]
      },
      offers: {
        entry: { name: SPRINT_NAME, price: SPRINT_PRICE, duration: "2 weeks" },
        recurring: { name: DESK_NAME, monthlyPrice: DESK_MONTHLY_PRICE }
      },
      triggerWeights: { ...TRIGGER_WEIGHTS },
      funnelStages: [...FUNNEL_STAGES],
      sequence: this.sequence()
    };
  }

  sequence() {
    return [
      {
        day: 1,
        delay: 2,
        subject: "A faster way to add capture capacity at {{company}}",
        body: `{{first_name}},\n\nI noticed {{company}} is expanding its federal capture/growth capability around {{specific_current_need}}.\n\nThis isn't a recruiting pitch.\n\nP2GC provides fractional capture intelligence underneath existing BD/capture leadership—so senior capture people can stay on customer relationships, shaping and decisions instead of assembling pursuit research.\n\nFor {{company}}, I'd start with {{specific_company_problem_or_vehicle}}.\n\nOur two-week ${SPRINT_NAME} triages priority pursuits, builds decision-ready capture briefs, maps incumbents, competitors and teaming gaps, and returns clear GO / REVIEW / NO-GO recommendations.\n\nThe Sprint is a fixed $2,500. If it proves useful, the ${DESK_NAME} is $5,000/month.\n\nWould a 15-minute conversation this week be unreasonable?\n\nKevin Carter\nPathways 2 Government Contracting\nFrom Eligibility to Awards — We Build the Entire Pathway.`
      },
      {
        day: 3,
        delay: 3,
        subject: "{{company}} — what I would put in the first capture brief",
        body: `{{first_name}},\n\nOne concrete example of what I mean:\n\nFor a priority {{vehicle_or_market}} pursuit, P2GC would give your capture lead one executive brief containing the buyer and mission fit, acquisition path, incumbent, likely competitors, relevant past-performance proof, teaming gaps, pursuit risks, PWin factors, recommended next actions and the evidence behind the recommendation.\n\nThe point isn't another dashboard.\n\nIt's reducing the hours your senior capture people spend turning scattered information into a decision.\n\nIf you send me one pursuit you're already considering, I can explain exactly how we would approach it during the two-week ${SPRINT_NAME}.\n\nOpen to 15 minutes?\n\nKevin`
      },
      {
        day: 6,
        delay: 4,
        subject: "Fractional capture support while {{company}} builds capacity",
        body: `{{first_name}},\n\nThe reason I reached out now is simple:\n\nAdding permanent capture talent takes time. The pursuit calendar doesn't wait.\n\nP2GC can function as the research and intelligence layer behind the team you already have:\n\n- opportunity, forecast and recompete monitoring,\n- qualification and bid/no-bid support,\n- agency/buyer and competitor intelligence,\n- teaming and prime/sub mapping,\n- capture-brief development, and\n- proposal-ready handoff.\n\nThat allows your internal leaders to stay focused on customer relationships, shaping and decisions.\n\nThe entry point is the fixed $2,500 ${SPRINT_NAME}—small enough to test on live work instead of debating a long consulting engagement.\n\nWorth testing on one pipeline?\n\nKevin`
      },
      {
        day: 10,
        delay: 0,
        subject: "Close the loop?",
        body: `{{first_name}},\n\nI'll close the loop after this.\n\nI reached out because {{company}} has a real federal growth/capture use case where P2GC can add capacity without another full-time seat.\n\nIf improving {{specific_capture_problem}} is a priority, I'd be glad to show you the two-week ${SPRINT_NAME} and exactly what the first deliverables would look like.\n\nIf it isn't a priority right now, no problem—I'll leave you alone.\n\nKevin`
      }
    ];
  }

  normalizeTriggers(lead = {}) {
    const raw = Array.isArray(lead.triggers)
      ? lead.triggers
      : Array.isArray(lead.capture_triggers)
        ? lead.capture_triggers
        : [];

    return raw
      .map(item => {
        if (typeof item === "string") {
          return { type: clean(item).toUpperCase(), evidence: "", source: "" };
        }
        return {
          type: clean(item?.type || item?.trigger || item?.name).toUpperCase(),
          evidence: clean(item?.evidence || item?.summary || item?.detail || item?.value),
          source: clean(item?.source || item?.url || item?.source_name)
        };
      })
      .filter(item => item.type);
  }

  triggerScore(lead = {}) {
    const triggers = this.normalizeTriggers(lead);
    const scored = triggers.map(trigger => ({
      ...trigger,
      weight: Number(TRIGGER_WEIGHTS[trigger.type] || 0),
      evidenceBacked: Boolean(trigger.evidence && !hasPlaceholder(trigger.evidence))
    }));
    const evidenceBacked = scored.filter(item => item.evidenceBacked && item.weight > 0);
    const score = evidenceBacked.reduce((sum, item) => sum + item.weight, 0);
    return { score, triggers: scored, evidenceBacked };
  }

  derivePersonalization(lead = {}, triggerResult = this.triggerScore(lead)) {
    const topTrigger = [...triggerResult.evidenceBacked].sort((a, b) => b.weight - a.weight)[0] || null;
    const vehicleOrMarket = clean(
      lead.vehicle_or_market || lead.vehicle || lead.market || lead.agency_market || lead.target_market
    );

    return {
      first_name: clean(lead.first_name || lead.firstName),
      company: clean(lead.company || lead.company_name || lead.companyName),
      specific_current_need: clean(lead.specific_current_need || topTrigger?.evidence),
      specific_company_problem_or_vehicle: clean(
        lead.specific_company_problem_or_vehicle ||
        lead.company_problem ||
        lead.capture_problem ||
        vehicleOrMarket
      ),
      vehicle_or_market: vehicleOrMarket,
      specific_capture_problem: clean(
        lead.specific_capture_problem ||
        lead.capture_problem ||
        lead.company_problem ||
        topTrigger?.evidence
      )
    };
  }

  qualifyLead(lead = {}) {
    const blockers = [];
    const triggerResult = this.triggerScore(lead);
    const personalization = this.derivePersonalization(lead, triggerResult);
    const status = clean(lead.status || lead.lead_status || lead.crm_status).toUpperCase();
    const email = clean(lead.email || lead.contact);

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) blockers.push("VALID_EMAIL_REQUIRED");
    if (status && SUPPRESSED_STATUSES.has(status)) blockers.push(`SUPPRESSED_STATUS:${status}`);
    if (lead.unsubscribed === true || lead.do_not_contact === true) blockers.push("DO_NOT_CONTACT");
    if (lead.replied === true || lead.meeting_booked === true) blockers.push("ACTIVE_CONVERSATION_OR_MEETING");
    if (triggerResult.evidenceBacked.length === 0) blockers.push("EVIDENCE_BACKED_CAPTURE_TRIGGER_REQUIRED");
    if (triggerResult.score < TRIGGER_THRESHOLD) blockers.push("CAPTURE_TRIGGER_SCORE_BELOW_THRESHOLD");

    for (const field of REQUIRED_PERSONALIZATION) {
      const value = personalization[field];
      if (!value || hasPlaceholder(value)) blockers.push(`PERSONALIZATION_REQUIRED:${field}`);
    }

    return {
      eligible: blockers.length === 0,
      email,
      status,
      score: triggerResult.score,
      triggers: triggerResult.triggers,
      evidenceBackedTriggers: triggerResult.evidenceBacked,
      personalization,
      blockers: [...new Set(blockers)]
    };
  }

  prepareAudience(candidates = [], options = {}) {
    const cap = Math.min(
      MAX_AUDIENCE,
      Math.max(1, Number(options.maxAudience || MAX_AUDIENCE))
    );
    const evaluated = (Array.isArray(candidates) ? candidates : []).map((lead, index) => ({
      index,
      lead,
      qualification: this.qualifyLead(lead)
    }));
    const eligible = evaluated
      .filter(item => item.qualification.eligible)
      .sort((a, b) => b.qualification.score - a.qualification.score)
      .slice(0, cap);
    const blocked = evaluated.filter(item => !item.qualification.eligible);

    return {
      ok: true,
      evaluated: evaluated.length,
      eligibleCount: eligible.length,
      blockedCount: blocked.length,
      capped: evaluated.filter(item => item.qualification.eligible).length > cap,
      cap,
      eligible,
      blocked
    };
  }

  buildCampaignPayload(options = {}) {
    const timezone = clean(options.timezone || process.env.P2GC_OUTBOUND_TIMEZONE || "America/New_York");
    const sendFrom = clean(options.sendFrom || "09:00");
    const sendTo = clean(options.sendTo || "16:30");
    const sequence = this.sequence();

    return {
      name: options.name || CAMPAIGN_NAME,
      campaign_schedule: {
        schedules: [
          {
            name: "P2GC Weekdays",
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
      daily_limit: Math.max(1, Number(options.dailyLimit || 50)),
      daily_max_leads: Math.max(1, Number(options.dailyMaxLeads || 50)),
      prioritize_new_leads: false,
      allow_risky_contacts: false,
      disable_bounce_protect: false,
      limit_emails_per_company_override: {
        mode: "custom",
        daily_limit: 1,
        scope: "per_campaign"
      },
      custom_variables: Object.fromEntries(REQUIRED_PERSONALIZATION.map(key => [key, ""]))
    };
  }

  buildLeadPayload(item, campaignId) {
    const lead = item.lead;
    const vars = item.qualification.personalization;
    return {
      campaign: campaignId,
      email: item.qualification.email,
      first_name: vars.first_name,
      last_name: clean(lead.last_name || lead.lastName),
      company_name: vars.company,
      website: clean(lead.website || lead.domain),
      job_title: clean(lead.job_title || lead.title),
      phone: clean(lead.phone),
      personalization: `Observed capture-capacity trigger: ${vars.specific_current_need}`,
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      verify_leads_on_import: true,
      custom_variables: {
        ...vars,
        campaign_key: CAMPAIGN_KEY,
        capture_trigger_score: item.qualification.score,
        capture_trigger_type: item.qualification.evidenceBackedTriggers[0]?.type || ""
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
    let sprintRevenue = 0;
    let deskMrr = 0;
    for (const event of Array.isArray(events) ? events : []) {
      const stage = clean(event.stage || event.eventType || event.status).toUpperCase();
      if (Object.prototype.hasOwnProperty.call(counts, stage)) counts[stage] += 1;
      if (stage === "SPRINT_WON") sprintRevenue += Number(event.revenue || SPRINT_PRICE);
      if (stage === "DESK_WON") deskMrr += Number(event.mrr || DESK_MONTHLY_PRICE);
    }
    return {
      counts,
      conversions: {
        targetedToEnrolledPct: pct(counts.ENROLLED, counts.TARGETED),
        enrolledToPositiveReplyPct: pct(counts.REPLIED_POSITIVE, counts.ENROLLED),
        positiveReplyToMeetingPct: pct(counts.MEETING_BOOKED, counts.REPLIED_POSITIVE),
        meetingToSprintPct: pct(counts.SPRINT_WON, counts.MEETING_BOOKED),
        sprintToDeskPct: pct(counts.DESK_WON, counts.SPRINT_WON)
      },
      sprintRevenue,
      deskMrr
    };
  }

  writeReport(report) {
    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    const temp = `${this.reportPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(report, null, 2), "utf8");
    fs.renameSync(temp, this.reportPath);
    return this.reportPath;
  }

  async execute(input = {}) {
    const audience = this.prepareAudience(input.candidates || [], input);
    const report = {
      ok: audience.eligibleCount > 0,
      service: this.service,
      campaignKey: CAMPAIGN_KEY,
      campaignName: CAMPAIGN_NAME,
      mode: input.apply === true ? "APPLY" : "PLAN_ONLY",
      status: audience.eligibleCount > 0 ? "READY" : "BLOCKED_NO_ELIGIBLE_LEADS",
      generatedAt: this.generatedAt(),
      definition: this.getCampaignDefinition(),
      audience: {
        evaluated: audience.evaluated,
        eligibleCount: audience.eligibleCount,
        blockedCount: audience.blockedCount,
        capped: audience.capped,
        cap: audience.cap,
        blocked: audience.blocked.map(item => ({
          email: item.qualification.email,
          company: item.qualification.personalization.company,
          blockers: item.qualification.blockers
        }))
      },
      campaignPayload: this.buildCampaignPayload(input),
      funnel: this.summarizeFunnel(input.events || []),
      externalMutationsAuthorized: input.apply === true,
      campaignCreated: false,
      leadsUploaded: 0,
      campaignActivated: false
    };

    if (audience.eligibleCount === 0 || input.apply !== true) {
      if (input.writeReport !== false) report.artifact = this.writeReport(report);
      return report;
    }

    const connector = this.getConnector();
    const campaignResult = await connector.execute({
      action: "createCampaign",
      payload: report.campaignPayload
    }, { reason: CAMPAIGN_KEY });
    report.campaignResult = campaignResult;
    const campaignId = this.extractCampaignId(campaignResult);
    report.campaignId = campaignId || null;

    if (!campaignId) {
      report.ok = Boolean(campaignResult?.ok);
      report.status = campaignResult?.result?.dryRun === true
        ? "INSTANTLY_DRY_RUN_CAMPAIGN_NOT_CREATED"
        : "CAMPAIGN_ID_NOT_RETURNED";
      if (input.writeReport !== false) report.artifact = this.writeReport(report);
      return report;
    }

    report.campaignCreated = true;
    const leads = audience.eligible.map(item => this.buildLeadPayload(item, campaignId));
    const uploadResult = await connector.execute({
      action: "uploadLeads",
      payload: { campaignId, leads }
    }, { reason: CAMPAIGN_KEY });
    report.uploadResult = uploadResult;
    report.leadsUploaded = Number(uploadResult?.uploaded || uploadResult?.result?.uploaded || 0);

    if (input.activate === true) {
      if (clean(input.activationApproval) !== `ACTIVATE:${CAMPAIGN_KEY}`) {
        report.ok = false;
        report.status = "ACTIVATION_APPROVAL_REQUIRED";
        report.activationRequired = `ACTIVATE:${CAMPAIGN_KEY}`;
      } else {
        const activationResult = await connector.execute({
          action: "activateCampaign",
          payload: { campaignId }
        }, { reason: `${CAMPAIGN_KEY}:CEO_APPROVED` });
        report.activationResult = activationResult;
        report.campaignActivated = Boolean(activationResult?.ok && activationResult?.result?.dryRun !== true);
        report.status = report.campaignActivated ? "CAMPAIGN_ACTIVATED" : "CAMPAIGN_PREPARED_NOT_ACTIVATED";
      }
    } else {
      report.status = "CAMPAIGN_PREPARED_DRAFT";
    }

    if (input.writeReport !== false) report.artifact = this.writeReport(report);
    return report;
  }
}

module.exports = CaptureCapacityCampaignService;
module.exports.CaptureCapacityCampaignService = CaptureCapacityCampaignService;
module.exports.constants = {
  CAMPAIGN_KEY,
  CAMPAIGN_NAME,
  SPRINT_NAME,
  DESK_NAME,
  SPRINT_PRICE,
  DESK_MONTHLY_PRICE,
  MAX_AUDIENCE,
  TRIGGER_THRESHOLD,
  REQUIRED_PERSONALIZATION,
  TRIGGER_WEIGHTS,
  FUNNEL_STAGES
};
