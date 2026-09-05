'use strict';

const fs = require('fs');
const path = require('path');
const GlobalSuppressionService = require('./GlobalSuppressionService');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(ROOT, 'CONFIG', 'P2GC_VIDEO_ROUTING_POLICY.json');

function bool(v) { return v === true; }
function clean(v) { return String(v == null ? '' : v).trim(); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
function nowIso() { return new Date().toISOString(); }
function uniq(values) { return [...new Set(values.filter(Boolean))]; }

class P2GCVideoRoutingService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;
    this.policy = options.policy || JSON.parse(fs.readFileSync(options.policyPath || POLICY_PATH, 'utf8').replace(/^\uFEFF/, ''));
    this.suppression = options.suppression || new GlobalSuppressionService({ rootDir: this.rootDir });
    this.now = options.now || nowIso;
  }

  scoreBucket(input, weights, playbackAware = false) {
    let raw = 0;
    const reasons = [];
    const add = (key, active) => {
      if (!active || !weights[key]) return;
      raw += weights[key];
      reasons.push({ key, points: weights[key] });
    };

    if (playbackAware) {
      add('replied', bool(input.replied));
      add('requestedDemo', bool(input.requestedDemo));
      add('videoStarted', bool(input.videoStarted) || Number(input.maxPlaybackPct || 0) > 0);
      const p = Number(input.maxPlaybackPct || 0);
      if (bool(input.videoComplete) || p >= 100) add('videoComplete', true);
      else if (p >= 75) add('playback75', true);
      else if (p >= 50) add('playback50', true);
      else if (p >= 25) add('playback25', true);
      add('clickedScheduling', bool(input.clickedScheduling));
      add('bookedAppointment', bool(input.bookedAppointment));
    } else {
      for (const key of Object.keys(weights)) {
        if (key === 'max') continue;
        add(key, bool(input[key]));
      }
    }

    return { score: clamp(raw, 0, weights.max), raw, reasons };
  }

  normalizedEvidence(input = {}) {
    const rows = Array.isArray(input.evidence) ? input.evidence : [];
    return rows.map(item => ({
      type: clean(item.type),
      claim: clean(item.claim),
      source: clean(item.source),
      sourceId: clean(item.sourceId),
      freshness: clean(item.freshness),
      confidence: clean(item.confidence).toUpperCase(),
      verified: item.verified === true,
      notes: clean(item.notes)
    }));
  }

  hasValidatedEvidence(evidence, types = []) {
    const wanted = new Set(types.map(x => clean(x).toUpperCase()));
    return evidence.some(e => {
      const typeOk = wanted.size === 0 || wanted.has(e.type.toUpperCase());
      return typeOk && e.verified && e.source && e.freshness && ['HIGH', 'MEDIUM'].includes(e.confidence);
    });
  }

  suppressionState(prospect = {}) {
    const email = clean(prospect.email).toLowerCase();
    if (prospect.optedOut === true) return { blocked: true, code: 'OPTED_OUT', evidence: 'prospect.optedOut=true' };
    if (prospect.invalidContact === true || !email) return { blocked: true, code: 'INVALID_CONTACT', evidence: !email ? 'missing email' : 'prospect.invalidContact=true' };
    if (String(prospect.contactConfidence || '').toUpperCase() === 'LOW') return { blocked: true, code: 'LOW_CONTACT_CONFIDENCE', evidence: 'contactConfidence=LOW' };
    const suppressed = this.suppression.get(email);
    if (suppressed) return { blocked: true, code: 'SUPPRESSED', evidence: suppressed };
    return { blocked: false };
  }

  detectTriggers(prospect = {}, scores, evidence) {
    const triggers = [];
    const p = Number(prospect.maxPlaybackPct || 0);

    if (prospect.requestedDemo) triggers.push('REQUESTED_DEMO');
    if (prospect.askedWhatP2GCDoes) triggers.push('ASKED_WHAT_P2GC_DOES');
    if (prospect.generalInterest) triggers.push('GENERAL_INTEREST');
    if (prospect.qualified && scores.total < 50) triggers.push('QUALIFIED_EARLY_STAGE');
    if (prospect.methodologyFollowupHelpful) triggers.push('METHODOLOGY_FOLLOWUP_HELPFUL');

    if (p >= 50) triggers.push('WATCHED_MEANINGFUL_PORTION');
    if (prospect.positiveReplyAfterDemo) triggers.push('POSITIVE_REPLY_AFTER_DEMO');
    if (prospect.specificGovConPain) triggers.push('SPECIFIC_GOVCON_PAIN');
    if (prospect.validatedCompanyTrigger && this.hasValidatedEvidence(evidence)) triggers.push('VALIDATED_COMPANY_TRIGGER');
    if (prospect.underusedVehicle && this.hasValidatedEvidence(evidence, ['VEHICLE_UTILIZATION'])) triggers.push('UNDERUSED_GSA_VA_VEHICLE');
    if (prospect.agencyConcentration && this.hasValidatedEvidence(evidence, ['AGENCY_CONCENTRATION'])) triggers.push('AGENCY_CONCENTRATION');
    if (prospect.recompeteExposure && this.hasValidatedEvidence(evidence, ['RECOMPETE_EXPOSURE'])) triggers.push('RECOMPETE_OR_EXPIRATION_EXPOSURE');
    if (prospect.weakGrowthTrajectory && this.hasValidatedEvidence(evidence, ['GROWTH_TRAJECTORY'])) triggers.push('WEAK_GROWTH_TRAJECTORY');
    if (prospect.currentOpportunityMatch && this.hasValidatedEvidence(evidence, ['CURRENT_OPPORTUNITY'])) triggers.push('CURRENT_OPPORTUNITY_MATCH');

    if (prospect.bookedAppointment) triggers.push('APPOINTMENT_BOOKED');
    if (prospect.explicitDeepAnalysisRequest) triggers.push('EXPLICIT_DEEP_ANALYSIS_REQUEST');
    if (scores.buyingIntent >= 15) triggers.push('STRONG_BUYING_INTENT');
    if (prospect.highExpectedEngagementValue) triggers.push('HIGH_EXPECTED_ENGAGEMENT_VALUE');
    if (prospect.meaningfulFederalRevenueOrVehiclePosition && this.hasValidatedEvidence(evidence)) triggers.push('MEANINGFUL_FEDERAL_REVENUE_OR_VEHICLE_POSITION');
    if (prospect.clearRevenueProtectionOrGrowthIssue && this.hasValidatedEvidence(evidence)) triggers.push('CLEAR_REVENUE_PROTECTION_OR_GROWTH_ISSUE');
    if (prospect.kevinTier1Strategic) triggers.push('KEVIN_TIER_1_STRATEGIC');

    return uniq(triggers);
  }

  decision(prospect = {}) {
    const suppression = this.suppressionState(prospect);
    const evidence = this.normalizedEvidence(prospect);
    if (suppression.blocked) {
      return this.output(prospect, {
        classification: 'NO VIDEO',
        reason: `Blocked by ${suppression.code}.`,
        evidence: [suppression.evidence],
        trigger: suppression.code,
        recommendedSendTime: null,
        nextCTA: 'NONE',
        kevinApprovalRequired: 'NO',
        scores: { engagement: 0, businessFit: 0, buyingIntent: 0, total: 0 },
        sendEligible: false,
        sendBlocked: true
      });
    }

    const engagement = this.scoreBucket(prospect, this.policy.scoreWeights.engagement, true);
    const businessFit = this.scoreBucket(prospect, this.policy.scoreWeights.businessFit, false);
    const buyingIntent = this.scoreBucket(prospect, this.policy.scoreWeights.buyingIntent, false);
    const scores = {
      engagement: engagement.score,
      businessFit: businessFit.score,
      buyingIntent: buyingIntent.score,
      total: engagement.score + businessFit.score + buyingIntent.score,
      detail: { engagement: engagement.reasons, businessFit: businessFit.reasons, buyingIntent: buyingIntent.reasons }
    };

    const triggers = this.detectTriggers(prospect, scores, evidence);
    const l1 = triggers.filter(t => this.policy.level1Triggers.includes(t));
    const l2 = triggers.filter(t => this.policy.level2Triggers.includes(t));
    const l3 = triggers.filter(t => this.policy.level3Triggers.includes(t));
    const personalizedEvidenceReady = this.hasValidatedEvidence(evidence);

    let classification = 'NO VIDEO';
    let reason = 'No video trigger is strong enough yet.';
    let selectedTriggers = [];
    let approval = 'NO';
    let sendTime = 'WAIT_FOR_NEXT_QUALIFYING_EVENT';
    let cta = 'CONTINUE_NORMAL_FOLLOWUP';

    const level3Qualified = l3.length > 0 && (
      prospect.bookedAppointment ||
      prospect.explicitDeepAnalysisRequest ||
      prospect.kevinTier1Strategic ||
      (scores.total >= this.policy.levels.LEVEL_3_DEEP_PERSONALIZED.minScore && personalizedEvidenceReady)
    );

    if (level3Qualified) {
      classification = 'LEVEL 3 — DEEP PERSONALIZED';
      reason = 'High-priority buying/meeting trigger supports a deep company-specific review.';
      selectedTriggers = l3;
      approval = 'YES';
      sendTime = prospect.bookedAppointment ? 'BEFORE_BOOKED_MEETING_AS_CALL_PREP' : 'AFTER_KEVIN_APPROVAL';
      cta = 'PREPARE_FOR_KEVIN_CONVERSATION';
    } else if (l2.length > 0 && scores.total >= this.policy.levels.LEVEL_2_SHORT_PERSONALIZED.minScore) {
      if (!personalizedEvidenceReady) {
        classification = l1.length ? 'LEVEL 1 — REUSABLE' : 'NO VIDEO';
        reason = 'Personalized trigger detected, but validated company/federal evidence is not sufficient for personalized claims.';
        selectedTriggers = l1.length ? l1 : l2;
        approval = 'NO';
        sendTime = l1.length ? 'NOW_IF_OUTBOUND_GOVERNANCE_PERMITS' : 'WAIT_FOR_VALIDATED_EVIDENCE';
        cta = l1.length ? 'WATCH_REUSABLE_DEMO' : 'VALIDATE_COMPANY_EVIDENCE';
      } else {
        classification = 'LEVEL 2 — SHORT PERSONALIZED';
        reason = 'Meaningful engagement or validated company-specific trigger justifies a short personalized follow-up.';
        selectedTriggers = l2;
        approval = 'YES';
        sendTime = 'AFTER_KEVIN_APPROVAL';
        cta = 'SPEAK_WITH_KEVIN';
      }
    } else if (l1.length > 0 || scores.total >= this.policy.levels.LEVEL_1_REUSABLE.minScore) {
      classification = 'LEVEL 1 — REUSABLE';
      reason = l1.length ? 'Early-stage interest is best served by the reusable methodology demo.' : 'Qualified score supports reusable-demo education without custom research.';
      selectedTriggers = l1.length ? l1 : ['QUALIFIED_SCORE'];
      approval = 'NO';
      sendTime = 'NOW_IF_OUTBOUND_GOVERNANCE_PERMITS';
      cta = 'WATCH_REUSABLE_DEMO';
    }

    const existingOutboundGovernancePermits = prospect.existingOutboundGovernancePermits === true;
    const sendEligible = classification === 'LEVEL 1 — REUSABLE' && existingOutboundGovernancePermits;

    return this.output(prospect, {
      classification,
      reason,
      evidence,
      trigger: selectedTriggers,
      recommendedSendTime: sendTime,
      nextCTA: cta,
      kevinApprovalRequired: approval,
      scores,
      sendEligible,
      sendBlocked: classification !== 'LEVEL 1 — REUSABLE' || !existingOutboundGovernancePermits,
      personalizedEvidenceReady
    });
  }

  output(prospect, decision) {
    return {
      ok: true,
      mode: this.policy.mode,
      prospectId: clean(prospect.prospectId) || null,
      companyName: clean(prospect.companyName) || null,
      contactEmail: clean(prospect.email).toLowerCase() || null,
      decisionAt: this.now(),
      videoDecision: decision.classification,
      videoRoutingScore: decision.scores?.total || 0,
      scoreBreakdown: decision.scores,
      reason: decision.reason,
      evidence: decision.evidence || [],
      trigger: decision.trigger || [],
      recommendedSendTime: decision.recommendedSendTime,
      nextCTA: decision.nextCTA,
      kevinApprovalRequired: decision.kevinApprovalRequired,
      personalizedEvidenceReady: decision.personalizedEvidenceReady === true,
      sendEligible: decision.sendEligible === true,
      sendBlocked: decision.sendBlocked !== false,
      governance: {
        recommendationOnly: true,
        sendExecutionImplemented: false,
        level2AutoSendAllowed: false,
        level3AutoSendAllowed: false
      }
    };
  }
}

module.exports = P2GCVideoRoutingService;
module.exports.P2GCVideoRoutingService = P2GCVideoRoutingService;
