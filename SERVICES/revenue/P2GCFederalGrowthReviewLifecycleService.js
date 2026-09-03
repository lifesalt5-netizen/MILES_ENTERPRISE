'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT_PATH = path.join(ROOT, 'CONFIG', 'P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json');
const STATE_DIR = path.join(ROOT, 'DATA', 'federal_growth_reviews');

function clean(v) { return String(v == null ? '' : v).trim(); }
function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, Number(n) || 0)); }
function nowIso() { return new Date().toISOString(); }
function safeId(v) { return clean(v).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, ''); }

class P2GCFederalGrowthReviewLifecycleService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;
    this.contractPath = options.contractPath || CONTRACT_PATH;
    this.stateDir = options.stateDir || STATE_DIR;
    this.contract = options.contract || this.loadContract();
  }

  loadContract() {
    return JSON.parse(fs.readFileSync(this.contractPath, 'utf8').replace(/^\uFEFF/, ''));
  }

  ensureDir() {
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  statePath(reviewId) {
    this.ensureDir();
    return path.join(this.stateDir, `${safeId(reviewId)}.json`);
  }

  createReview(input = {}) {
    const company = input.company || {};
    const recipient = input.recipient || {};
    if (!clean(company.name)) throw new Error('COMPANY_NAME_REQUIRED');
    if (!clean(recipient.email)) throw new Error('RECIPIENT_EMAIL_REQUIRED');

    const createdAt = nowIso();
    const expirationHours = this.resolveExpirationHours(input.expirationHours);
    const reviewId = input.reviewId || `P2GC-FGR-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const requiredStages = [...this.contract.greenDefinition.requiredStages];
    const stageState = Object.fromEntries(requiredStages.map(stage => [stage, {
      status: 'PENDING',
      completedAt: null,
      evidence: null
    }]));

    const record = {
      version: 1,
      reviewId,
      status: 'DRAFT',
      green: false,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.parse(createdAt) + expirationHours * 3600000).toISOString(),
      expirationHours,
      company: {
        name: clean(company.name),
        uei: clean(company.uei) || null,
        cage: clean(company.cage) || null,
        domain: clean(company.domain).toLowerCase() || null
      },
      recipient: {
        email: clean(recipient.email).toLowerCase(),
        name: clean(recipient.name) || null,
        companyDomain: clean(recipient.companyDomain || company.domain).toLowerCase() || null
      },
      security: {
        private: true,
        authenticated: true,
        noIndex: true,
        downloadable: false,
        approvedRecipientEmail: clean(recipient.email).toLowerCase(),
        approvedCompanyDomain: clean(recipient.companyDomain || company.domain).toLowerCase() || null,
        sameCompanyColleagueAccess: 'AUTHORIZATION_REQUIRED',
        outsideForwardingGrantsAccess: false,
        signedShortLivedVideoTokens: true,
        directMediaExposure: false,
        dynamicWatermark: true,
        concurrentSessionLimitRequired: true,
        suspiciousAccessDetectionRequired: true,
        revokedAt: null
      },
      stageState,
      findings: [],
      priorityOptions: [],
      engagement: [],
      engagementSummary: this.emptyEngagementSummary(),
      scoring: {
        fitScore: 0,
        intentScore: 0,
        salesPriority: 0,
        fitUpdatedAt: null,
        intentUpdatedAt: null,
        salesPriorityUpdatedAt: null,
        inputs: { fit: [], intent: [] }
      },
      release: {
        approvedByKevin: false,
        approvedAt: null,
        sentAt: null,
        sentFrom: null,
        secureLinkId: null
      },
      attribution: {
        meetingId: null,
        proposalId: null,
        paymentId: null,
        closedAt: null,
        revenue: 0,
        currency: 'USD'
      }
    };

    this.write(record);
    return record;
  }

  resolveExpirationHours(value) {
    const allowed = this.contract.security.allowedExpirationHours || [48, 72];
    const requested = Number(value || this.contract.security.defaultExpirationHours || 72);
    return allowed.includes(requested) ? requested : Number(this.contract.security.defaultExpirationHours || 72);
  }

  emptyEngagementSummary() {
    return {
      sent: false,
      delivered: false,
      authenticatedAccessCount: 0,
      videoStartCount: 0,
      maxPlaybackPct: 0,
      completionCount: 0,
      repeatVisitCount: 0,
      ctaClickCount: 0,
      questionCount: 0,
      schedulingOpenedCount: 0,
      meetingBooked: false,
      proposalCreated: false,
      proposalSent: false,
      closed: false,
      paymentRecorded: false,
      revenueAttributed: false
    };
  }

  read(reviewId) {
    return JSON.parse(fs.readFileSync(this.statePath(reviewId), 'utf8').replace(/^\uFEFF/, ''));
  }

  write(record) {
    record.updatedAt = nowIso();
    const file = this.statePath(record.reviewId);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    try { fs.renameSync(tmp, file); }
    catch { fs.copyFileSync(tmp, file); try { fs.unlinkSync(tmp); } catch {} }
    return record;
  }

  completeStage(reviewId, stage, evidence = {}) {
    const record = this.read(reviewId);
    if (!record.stageState[stage]) throw new Error(`UNKNOWN_REVIEW_STAGE:${stage}`);
    record.stageState[stage] = {
      status: 'COMPLETE',
      completedAt: nowIso(),
      evidence: this.normalizeEvidence(evidence)
    };
    this.recalculateGreen(record);
    return this.write(record);
  }

  blockStage(reviewId, stage, blocker = {}) {
    const record = this.read(reviewId);
    if (!record.stageState[stage]) throw new Error(`UNKNOWN_REVIEW_STAGE:${stage}`);
    record.stageState[stage] = {
      status: 'BLOCKED',
      completedAt: null,
      evidence: this.normalizeEvidence(blocker)
    };
    this.recalculateGreen(record);
    return this.write(record);
  }

  normalizeEvidence(evidence = {}) {
    return {
      source: evidence.source || null,
      freshness: evidence.freshness || null,
      confidence: evidence.confidence || null,
      verificationState: evidence.verificationState || null,
      artifact: evidence.artifact || null,
      notes: evidence.notes || null
    };
  }

  addFinding(reviewId, finding = {}) {
    const record = this.read(reviewId);
    if (!clean(finding.title)) throw new Error('FINDING_TITLE_REQUIRED');
    const material = finding.material !== false;
    if (material) {
      for (const field of ['source', 'freshness', 'confidence', 'verificationState']) {
        if (!clean(finding[field])) throw new Error(`MATERIAL_FINDING_${field.toUpperCase()}_REQUIRED`);
      }
    }
    const item = {
      id: finding.id || `finding-${record.findings.length + 1}`,
      section: finding.section || null,
      title: clean(finding.title),
      finding: clean(finding.finding),
      whatItMeans: clean(finding.whatItMeans),
      whyItMatters: clean(finding.whyItMatters),
      businessImpact: clean(finding.businessImpact),
      howP2GCAddressesIt: clean(finding.howP2GCAddressesIt),
      source: clean(finding.source) || null,
      freshness: clean(finding.freshness) || null,
      confidence: clean(finding.confidence) || null,
      verificationState: clean(finding.verificationState) || null,
      material,
      freePreviewVisibility: finding.freePreviewVisibility || 'REPRESENTATIVE',
      createdAt: nowIso()
    };
    record.findings.push(item);
    record.priorityOptions = this.derivePriorityOptions(record.findings);
    return this.write(record);
  }

  derivePriorityOptions(findings = []) {
    return findings
      .filter(f => f.material && f.freePreviewVisibility !== 'LOCKED')
      .slice(0, 5)
      .map(f => ({ id: f.id, label: f.title }));
  }

  updateFitScore(reviewId, score, inputs = []) {
    const record = this.read(reviewId);
    record.scoring.fitScore = clamp(score);
    record.scoring.fitUpdatedAt = nowIso();
    record.scoring.inputs.fit = Array.isArray(inputs) ? inputs : [inputs];
    this.recalculateSalesPriority(record);
    return this.write(record);
  }

  updateIntentScore(reviewId, score, inputs = []) {
    const record = this.read(reviewId);
    record.scoring.intentScore = clamp(score);
    record.scoring.intentUpdatedAt = nowIso();
    record.scoring.inputs.intent = Array.isArray(inputs) ? inputs : [inputs];
    this.recalculateSalesPriority(record);
    return this.write(record);
  }

  recalculateSalesPriority(record) {
    // Deliberately combines but never collapses FIT and INTENT into one source score.
    record.scoring.salesPriority = clamp((record.scoring.fitScore * 0.55) + (record.scoring.intentScore * 0.45));
    record.scoring.salesPriorityUpdatedAt = nowIso();
  }

  recordEngagement(reviewId, eventType, payload = {}) {
    const allowed = new Set(this.contract.engagementTracking || []);
    if (!allowed.has(eventType)) throw new Error(`UNSUPPORTED_REVIEW_EVENT:${eventType}`);
    const record = this.read(reviewId);
    const event = {
      id: crypto.randomUUID(),
      type: eventType,
      at: nowIso(),
      recipientEmail: payload.recipientEmail || null,
      sessionId: payload.sessionId || null,
      value: payload.value ?? null,
      metadata: payload.metadata || null
    };
    record.engagement.push(event);
    this.applyEngagementSummary(record, event);
    this.recalculateIntentFromEngagement(record);
    return this.write(record);
  }

  applyEngagementSummary(record, event) {
    const s = record.engagementSummary;
    switch (event.type) {
      case 'SEND': s.sent = true; break;
      case 'DELIVERY': s.delivered = true; break;
      case 'AUTHENTICATED_REVIEW_ACCESS': s.authenticatedAccessCount += 1; if (s.authenticatedAccessCount > 1) s.repeatVisitCount += 1; break;
      case 'VIDEO_START': s.videoStartCount += 1; break;
      case 'VIDEO_25': s.maxPlaybackPct = Math.max(s.maxPlaybackPct, 25); break;
      case 'VIDEO_50': s.maxPlaybackPct = Math.max(s.maxPlaybackPct, 50); break;
      case 'VIDEO_75': s.maxPlaybackPct = Math.max(s.maxPlaybackPct, 75); break;
      case 'VIDEO_90': s.maxPlaybackPct = Math.max(s.maxPlaybackPct, 90); break;
      case 'VIDEO_COMPLETE': s.maxPlaybackPct = 100; s.completionCount += 1; break;
      case 'REPEAT_VISIT': s.repeatVisitCount += 1; break;
      case 'CTA_CLICK': s.ctaClickCount += 1; break;
      case 'QUESTION_SUBMITTED': s.questionCount += 1; break;
      case 'SCHEDULING_OPENED': s.schedulingOpenedCount += 1; break;
      case 'MEETING_BOOKED': s.meetingBooked = true; break;
      case 'PROPOSAL_CREATED': s.proposalCreated = true; break;
      case 'PROPOSAL_SENT': s.proposalSent = true; break;
      case 'CLOSE': s.closed = true; break;
      case 'PAYMENT': s.paymentRecorded = true; break;
      case 'REVENUE_ATTRIBUTION': s.revenueAttributed = true; break;
    }
  }

  recalculateIntentFromEngagement(record) {
    const s = record.engagementSummary;
    let score = 0;
    if (s.delivered) score += 5;
    if (s.authenticatedAccessCount > 0) score += 10;
    score += Math.min(10, s.repeatVisitCount * 4);
    if (s.videoStartCount > 0) score += 5;
    score += Math.round(s.maxPlaybackPct * 0.25);
    score += Math.min(10, s.ctaClickCount * 5);
    score += Math.min(10, s.questionCount * 5);
    if (s.schedulingOpenedCount > 0) score += 10;
    if (s.meetingBooked) score += 15;
    record.scoring.intentScore = clamp(score);
    record.scoring.intentUpdatedAt = nowIso();
    record.scoring.inputs.intent = ['ENGAGEMENT_BEHAVIOR'];
    this.recalculateSalesPriority(record);
  }

  approveRelease(reviewId, actor = 'KEVIN') {
    const record = this.read(reviewId);
    record.release.approvedByKevin = actor === 'KEVIN';
    record.release.approvedAt = nowIso();
    if (record.release.approvedByKevin) {
      this.markStageCompleteInMemory(record, 'KEVIN_APPROVAL', { source: 'KEVIN_APPROVAL', verificationState: 'CONFIRMED' });
    }
    this.recalculateGreen(record);
    return this.write(record);
  }

  markSent(reviewId, { sentFrom, secureLinkId } = {}) {
    const record = this.read(reviewId);
    if (!record.release.approvedByKevin) throw new Error('KEVIN_APPROVAL_REQUIRED_BEFORE_SEND');
    if (clean(sentFrom).toLowerCase() !== 'kevin@pathways2gc.com') throw new Error('HIGH_VALUE_REVIEW_MUST_SEND_FROM_KEVIN_PATHWAYS2GC');
    record.release.sentAt = nowIso();
    record.release.sentFrom = clean(sentFrom).toLowerCase();
    record.release.secureLinkId = secureLinkId || null;
    this.markStageCompleteInMemory(record, 'SECURE_SEND_FROM_KEVIN', { source: 'P2GC_DELIVERY', verificationState: 'CONFIRMED' });
    this.applyEngagementSummary(record, { type: 'SEND' });
    this.recalculateIntentFromEngagement(record);
    this.recalculateGreen(record);
    return this.write(record);
  }

  markStageCompleteInMemory(record, stage, evidence = {}) {
    if (!record.stageState[stage]) return;
    record.stageState[stage] = {
      status: 'COMPLETE',
      completedAt: nowIso(),
      evidence: this.normalizeEvidence(evidence)
    };
  }

  revoke(reviewId, reason = 'MANUAL_REVOCATION') {
    const record = this.read(reviewId);
    record.security.revokedAt = nowIso();
    record.security.revocationReason = reason;
    record.status = 'REVOKED';
    record.green = false;
    return this.write(record);
  }

  authorizeAccess(reviewId, request = {}) {
    const record = this.read(reviewId);
    const now = Date.now();
    if (record.security.revokedAt) return { ok: false, reason: 'REVIEW_REVOKED' };
    if (now >= Date.parse(record.expiresAt)) return { ok: false, reason: 'REVIEW_EXPIRED' };
    const email = clean(request.email).toLowerCase();
    if (!email) return { ok: false, reason: 'EMAIL_REQUIRED' };
    if (email === record.security.approvedRecipientEmail) return { ok: true, access: 'PRIMARY_RECIPIENT' };
    const domain = email.split('@')[1] || '';
    if (domain && domain === record.security.approvedCompanyDomain) return { ok: false, reason: 'SAME_COMPANY_AUTHORIZATION_REQUIRED' };
    return { ok: false, reason: 'OUTSIDE_ORGANIZATION_ACCESS_DENIED' };
  }

  recalculateGreen(record) {
    const required = this.contract.greenDefinition.requiredStages || [];
    const allComplete = required.every(stage => record.stageState?.[stage]?.status === 'COMPLETE');
    record.green = allComplete && !record.security.revokedAt;
    record.status = record.green ? 'GREEN' : (record.release.sentAt ? 'ACTIVE' : 'DRAFT');
    return record.green;
  }

  getGreenGate(reviewId) {
    const record = this.read(reviewId);
    const missing = Object.entries(record.stageState)
      .filter(([, state]) => state.status !== 'COMPLETE')
      .map(([stage, state]) => ({ stage, status: state.status }));
    return {
      ok: record.green === true,
      status: record.green ? 'P2GC_PERSONALIZED_REVIEW_END_TO_END_GREEN' : 'P2GC_PERSONALIZED_REVIEW_NOT_GREEN',
      reviewId,
      missingStages: missing,
      scoring: record.scoring,
      expiresAt: record.expiresAt,
      revokedAt: record.security.revokedAt
    };
  }
}

module.exports = P2GCFederalGrowthReviewLifecycleService;
