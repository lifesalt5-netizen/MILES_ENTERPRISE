'use strict';

const ExecutiveConfigurationService = require('./ExecutiveConfigurationService');
const ExecutiveContextService = require('../executive/ExecutiveContextService');
const ExecutiveMemoryService = require('../executive/ExecutiveMemoryService');

class ExecutiveDecisionEngine {
  constructor(options = {}) {
    this.configurationService = options.configurationService || new ExecutiveConfigurationService({ rootDir: options.rootDir || process.cwd() });
    this.contextService = options.contextService || new ExecutiveContextService({ rootDir: options.rootDir || process.cwd(), providers: options.providers || {} });
    this.memoryService = options.memoryService || new ExecutiveMemoryService({ rootDir: options.rootDir || process.cwd() });
    this.logger = options.logger || console;
    this.lastContext = null;
  }

  normalizeMission(mission = {}) {
    const normalized = {
      id: mission.id || mission.missionId || this.createId(),
      title: String(mission.title || mission.name || 'Untitled mission'),
      objective: String(mission.objective || mission.description || mission.title || ''),
      provider: String(mission.provider || mission.source || 'UNKNOWN'),
      department: String(mission.department || mission.area || 'UNKNOWN'),
      priority: Number(mission.priority) || 0,
      expectedRevenue: Number(mission.expectedRevenue || mission.revenueImpact || mission.revenue || 0) || 0,
      urgency: Number(mission.urgency || mission.timeSensitivity || 0) || 0,
      risk: Number(mission.risk || mission.executionRisk || 0) || 0,
      customerImpact: Number(mission.customerImpact || mission.customerValue || 0) || 0,
      strategicValue: Number(mission.strategicValue || mission.businessValue || 0) || 0,
      executionConfidence: Number(mission.executionConfidence || mission.confidence || 0) || 0,
      requiresCEO: Boolean(mission.requiresCEO || mission.requiresKevin || mission.ceoApprovalRequired || mission.approvalRequired),
      estimatedDuration: Number(mission.estimatedDuration || mission.duration || 0) || 0,
      metadata: mission.metadata || {}
    };

    if (!mission || Object.keys(mission).length === 0) {
      this.warn('Mission input was empty; using zeroed defaults.');
    }

    return normalized;
  }

  buildContext() {
    if (!this.contextService || typeof this.contextService.buildContext !== 'function') {
      this.lastContext = null;
      return null;
    }

    this.lastContext = this.contextService.buildContext() || null;
    return this.lastContext;
  }

  scoreMission(mission, context = null) {
    const normalized = this.normalizeMission(mission);
    const policy = this.configurationService.getExecutivePolicy();
    const activeContext = context || this.buildContext() || {};

    const revenueImpact = this.normalizeMetric(normalized.expectedRevenue);
    const urgency = this.normalizeMetric(normalized.urgency);
    const customerImpact = this.normalizeMetric(normalized.customerImpact);
    const strategicValue = this.normalizeMetric(normalized.strategicValue);
    const riskReduction = normalized.risk > 0 ? this.normalizeMetric(100 - this.toNumber(normalized.risk)) : 0;
    const executionConfidence = this.normalizeMetric(normalized.executionConfidence);

    const hasAnySignal = [revenueImpact, urgency, customerImpact, strategicValue, riskReduction, executionConfidence].some((value) => value > 0);

    const weights = {
      revenueImpact: 0.3,
      urgency: 0.2,
      customerImpact: 0.15,
      strategicValue: 0.15,
      riskReduction: 0.1,
      executionConfidence: 0.1
    };

    const baseScore = (
      revenueImpact * weights.revenueImpact +
      urgency * weights.urgency +
      customerImpact * weights.customerImpact +
      strategicValue * weights.strategicValue +
      riskReduction * weights.riskReduction +
      executionConfidence * weights.executionConfidence
    );

    const baseFinalScore = hasAnySignal ? Number(baseScore.toFixed(2)) : 0;
    const contextAdjustment = this.calculateContextAdjustment(normalized, activeContext);
    const memoryAdjustment = this.calculateMemoryAdjustment(normalized, this.memoryService);
    const combinedAdjustment = this.clampAdjustment(contextAdjustment.adjustment + memoryAdjustment.adjustment);
    const finalScore = hasAnySignal
      ? Number(Math.max(0, Math.min(100, baseFinalScore + combinedAdjustment)).toFixed(2))
      : 0;
    const reason = this.buildReason(normalized, policy, finalScore, contextAdjustment, memoryAdjustment);

    return {
      ...normalized,
      score: finalScore,
      reason,
      contextAdjustment: contextAdjustment.adjustment,
      contextReason: contextAdjustment.reason,
      memoryAdjustment: memoryAdjustment.adjustment,
      memoryReason: memoryAdjustment.reason,
      memoryConfidence: memoryAdjustment.confidence,
      requiresCEO: normalized.requiresCEO || this.requiresCeoByPolicy(normalized, policy)
    };
  }

  rankMissions(missions = []) {
    const context = this.buildContext();
    const ranked = (missions || []).map((mission) => this.scoreMission(mission, context));
    ranked.sort((left, right) => right.score - left.score || this.compareTitle(left, right));
    return ranked.map((item, index) => ({
      ...item,
      rank: index + 1
    }));
  }

  buildExecutiveAgenda(input = {}) {
    const missions = Array.isArray(input.missions) ? input.missions : (input.candidates || []);
    const ranked = this.rankMissions(missions);
    const policy = this.configurationService.getExecutivePolicy();

    const agenda = ranked.slice(0, Math.max(1, Number(input.limit) || 5)).map((mission, index) => ({
      id: mission.id,
      title: mission.title,
      score: mission.score,
      rank: index + 1,
      reason: mission.reason,
      expectedBusinessImpact: this.describeImpact(mission, policy),
      requiresCEO: mission.requiresCEO,
      provider: mission.provider,
      department: mission.department
    }));

    const deferred = ranked.slice(Math.max(1, Number(input.limit) || 5)).map((mission) => ({
      id: mission.id,
      title: mission.title,
      score: mission.score,
      rank: mission.rank,
      reason: mission.reason,
      expectedBusinessImpact: this.describeImpact(mission, policy),
      requiresCEO: mission.requiresCEO
    }));

    const executiveScore = agenda[0] ? agenda[0].score : 0;
    const topPriority = agenda[0] || null;
    const requiresCEO = agenda.some((item) => item.requiresCEO) || ranked.some((item) => item.requiresCEO);

    return {
      generatedAt: new Date().toISOString(),
      executiveScore,
      topPriority,
      agenda,
      deferred,
      requiresCEO
    };
  }

  explainDecision(mission) {
    const scored = this.scoreMission(mission, this.buildContext());
    return scored.reason || `This mission ranked #${scored.rank || 1} based on its weighted executive value.`;
  }

  calculateContextAdjustment(mission = {}, context = {}) {
    const normalized = this.normalizeMission(mission);
    const revenue = context && context.revenue ? context.revenue : {};
    const sales = context && context.sales ? context.sales : {};
    const marketing = context && context.marketing ? context.marketing : {};
    const operations = context && context.operations ? context.operations : {};
    const executive = context && context.executive ? context.executive : {};
    const orion = context && context.orion ? context.orion : {};
    const infrastructure = context && context.infrastructure ? context.infrastructure : {};

    const text = `${normalized.title || ''} ${normalized.objective || ''}`.toLowerCase();
    const reasons = [];
    let adjustment = 0;

    const isSalesSignal = /sales|reply|follow|meeting|proposal|pipeline|deal/.test(text);
    const isProposalSignal = /proposal|proposal work|proposal deadline|follow-up/.test(text);
    const isMarketingSignal = /campaign|deliverability|mailbox|marketing|outreach|inbox/.test(text);
    const isInfrastructureSignal = /connector|runtime|infrastructure|api|repair|recovery|sync|refresh|ingestion/.test(text);

    if (Number(revenue.monthlyRevenue || 0) < Number(revenue.revenueGoal || 0)) {
      if (isSalesSignal || isProposalSignal) {
        adjustment += 12;
        reasons.push('Revenue is below monthly goal.');
      }
    }

    if (isProposalSignal) {
      if (/(tomorrow|soon|deadline|urgent|immediate)/.test(text)) {
        adjustment += 10;
        reasons.push('Proposal deadline is tomorrow.');
      } else if (normalized.urgency > 0) {
        adjustment += 6;
        reasons.push('Proposal urgency is elevated.');
      }
    }

    if (normalized.requiresCEO || Number(executive.ceoApprovalsRequired || 0) > 0 || /ceo|approval|commitment/.test(text)) {
      adjustment += 8;
      reasons.push('CEO review required.');
    }

    const deliverability = String(marketing.deliverabilityStatus || '').toLowerCase();
    if (isMarketingSignal && (deliverability === 'unhealthy' || Number(marketing.unhealthyCampaigns || 0) > 0)) {
      adjustment += 10;
      reasons.push('Deliverability is unhealthy.');
    }

    if (isMarketingSignal && Number(marketing.unhealthyCampaigns || 0) > 0) {
      adjustment += 4;
      reasons.push('Campaign health is below target.');
    }

    const orionHealth = String(orion.ingestionHealth || '').toLowerCase();
    if ((orionHealth === 'stale' || orionHealth === 'unknown' || orionHealth === 'degraded') && /(refresh|sync|ingestion|data|orion)/.test(text)) {
      adjustment += 8;
      reasons.push('ORION data needs refresh.');
    }

    const runtimeHealth = String(infrastructure.runtimeHealth || '').toLowerCase();
    if (isInfrastructureSignal && (runtimeHealth.includes('fail') || runtimeHealth.includes('degraded'))) {
      adjustment += 12;
      reasons.push('Infrastructure health is degraded.');
    }

    if (Number(sales.positiveReplies || 0) > 0 && isSalesSignal) {
      adjustment += 4;
      reasons.push('Positive replies require follow-up.');
    }

    if (Number(operations.failedWork || 0) > 0 && isInfrastructureSignal) {
      adjustment += 6;
      reasons.push('Operational failures are increasing urgency.');
    }

    return {
      adjustment: Number(adjustment.toFixed(2)),
      reason: reasons.join(' ')
    };
  }

  calculateMemoryAdjustment(mission = {}, memoryService = null) {
    const normalized = this.normalizeMission(mission);
    const service = memoryService || this.memoryService;
    const text = `${normalized.title || ''} ${normalized.objective || ''}`.toLowerCase();
    let adjustment = 0;
    const reasons = [];
    let confidence = 0.5;

    if (!service || typeof service.getLearningSummary !== 'function') {
      return { adjustment: 0, reason: '', confidence: 0 };
    }

    const summary = service.getLearningSummary ? service.getLearningSummary() : {};
    const history = service.getMissionHistory ? service.getMissionHistory(20) : [];
    const recommendations = service.getRecommendations ? service.getRecommendations() : [];

    const category = String(normalized.metadata && normalized.metadata.category || normalized.department || 'GENERAL').toUpperCase();
    const missionTitle = String(normalized.title || '').toLowerCase();

    const repeatedFailures = Array.isArray(summary.repeatedFailures) ? summary.repeatedFailures : [];
    const repeatedSuccesses = Array.isArray(summary.repeatedSuccesses) ? summary.repeatedSuccesses : [];
    const proposalOutcomes = Number(summary.proposalOutcomes || 0);
    const failedCount = Number(summary.failedMissions || 0);
    const ceoOverrides = Number(summary.ceoOverrides || 0);
    const infrastructureIncidents = Number(summary.infrastructureIncidents || 0);

    const repeatedFailureEntry = repeatedFailures.find((item) => String(item && item.name || '').toLowerCase() === missionTitle);
    const repeatedSuccessEntry = repeatedSuccesses.find((item) => String(item && item.name || '').toUpperCase() === category);

    if (repeatedFailureEntry) {
      adjustment -= 10;
      reasons.push('Mission history shows repeated failures.');
      confidence += 0.2;
    }

    if (repeatedSuccessEntry) {
      adjustment += 8;
      reasons.push('Mission type has historically produced strong outcomes.');
      confidence += 0.2;
    }

    if (proposalOutcomes > 0 && /proposal|proposal work/.test(text)) {
      adjustment += 6;
      reasons.push('Proposal work has historically won.');
      confidence += 0.1;
    }

    if (ceoOverrides > 0 && /proposal|ceo|approval/.test(text)) {
      adjustment += 4;
      reasons.push('CEO overrides are common for this mission type.');
      confidence += 0.1;
    }

    if (infrastructureIncidents > 0 && /connector|runtime|infrastructure|repair|maintenance|preventive/.test(text)) {
      adjustment += 6;
      reasons.push('Repeated infrastructure failures increase preventive urgency.');
      confidence += 0.1;
    }

    if (recommendations.includes('Marketing repairs reduce failures.')) {
      adjustment += 3;
      reasons.push('Marketing repair patterns improve reliability.');
      confidence += 0.05;
    }

    if (history.length > 0) {
      confidence = Math.min(1, confidence + 0.1);
    }

    return {
      adjustment: this.clampAdjustment(adjustment),
      reason: reasons.join(' '),
      confidence: Number(confidence.toFixed(2))
    };
  }

  clampAdjustment(adjustment) {
    const maxAdjustment = 20;
    return Math.max(-maxAdjustment, Math.min(maxAdjustment, Number(adjustment) || 0));
  }

  requiresCeoByPolicy(mission, policy = {}) {
    const approvalItems = Array.isArray(policy.ceoApprovalRequired) ? policy.ceoApprovalRequired : [];
    const text = `${mission.title || ''} ${mission.objective || ''} ${mission.provider || ''}`.toLowerCase();
    const normalizedText = text.replace(/[^a-z0-9\s]/g, ' ');
    const singularText = normalizedText.replace(/\s+proposals\b/g, ' proposal').replace(/\s+actions\b/g, ' action');

    const hasSensitiveSignals = /\b(proposal|proposals|contract|money|purchase|hire|terminate|delete|disable|credential|irreversible|public|dns|domain|social|legal|commitment)\b/.test(singularText);

    const matchedPolicy = approvalItems.some((item) => {
      const candidate = String(item || '').toLowerCase();
      if (!candidate) return false;

      const normalizedCandidate = candidate.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+s\b/g, '');
      const normalizedPolicyText = normalizedCandidate.replace(/\s+proposals\b/g, ' proposal').replace(/\s+actions\b/g, ' action');

      if (normalizedPolicyText === 'spend money' && singularText.includes('proposal')) {
        return true;
      }

      if (normalizedPolicyText === 'submit final proposal' && singularText.includes('proposal')) {
        return true;
      }

      return singularText.includes(normalizedPolicyText) || normalizedText.includes(candidate);
    });

    return matchedPolicy || hasSensitiveSignals;
  }

  buildReason(mission, policy = {}, score, contextAdjustment = {}, memoryAdjustment = {}) {
    const primaryGoal = policy && policy.primaryGoal && policy.primaryGoal.name ? policy.primaryGoal.name : 'the primary business objective';
    const reasons = [];

    if (mission.expectedRevenue > 0) reasons.push('creates revenue');
    if (mission.urgency > 0) reasons.push('has urgent timing');
    if (mission.customerImpact > 0) reasons.push('supports customer value');
    if (mission.strategicValue > 0) reasons.push('supports strategic priorities');
    if (mission.executionConfidence > 0) reasons.push('has low execution risk');
    if (mission.requiresCEO) reasons.push('requires CEO approval');

    const baseReason = reasons.length === 0
      ? `This mission ranked based on its weighted executive score and aligns with ${primaryGoal}.`
      : `This mission ranked with a score of ${score} because it ${reasons.join(', ')} and supports ${primaryGoal}.`;

    const contextReason = contextAdjustment && contextAdjustment.reason ? `Context added ${this.formatAdjustment(contextAdjustment.adjustment)} because ${contextAdjustment.reason}` : '';
    const memoryReason = memoryAdjustment && memoryAdjustment.reason ? `Memory added ${this.formatAdjustment(memoryAdjustment.adjustment)} because ${memoryAdjustment.reason}. Confidence ${Number(memoryAdjustment.confidence || 0).toFixed(2)}` : '';

    if (!contextReason && !memoryReason) {
      return baseReason;
    }

    return [baseReason, contextReason, memoryReason].filter(Boolean).join(' ');
  }

  formatAdjustment(adjustment) {
    const value = Number(adjustment || 0);
    return value >= 0 ? `+${value}` : String(value);
  }

  describeImpact(mission, policy = {}) {
    const impact = [];

    if (mission.expectedRevenue > 0) impact.push(`expected revenue impact of ${mission.expectedRevenue}`);
    if (mission.customerImpact > 0) impact.push(`customer impact of ${mission.customerImpact}`);
    if (mission.strategicValue > 0) impact.push(`strategic value of ${mission.strategicValue}`);

    if (impact.length === 0) {
      return `Supports ${policy.primaryGoal && policy.primaryGoal.name ? policy.primaryGoal.name : 'the primary executive objective'}.`;
    }

    return `Supports business execution by ${impact.join(', ')}.`;
  }

  compareTitle(left, right) {
    return String(left.title || '').localeCompare(String(right.title || ''));
  }

  createId() {
    return `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  normalizeMetric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
  }

  warn(message) {
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(message);
    }
  }

  toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

module.exports = ExecutiveDecisionEngine;
