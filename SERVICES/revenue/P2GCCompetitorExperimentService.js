'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}
function clean(v) { return String(v || '').trim(); }
function upper(v) { return clean(v).toUpperCase(); }
function finite(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

class P2GCCompetitorExperimentService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.rulesPath = options.rulesPath || path.join(this.rootDir, 'CONFIG', 'p2gc_competitor_intelligence_rules.json');
    this.rules = options.rules || readJson(this.rulesPath, {});
    this.inputDir = options.inputDir || path.join(this.rootDir, 'DATA', 'marketing_coo', 'competitor_intelligence');
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'marketing_coo', 'competitor_intelligence');
  }

  latestSnapshotPath() {
    if (!fs.existsSync(this.inputDir)) return null;
    const files = fs.readdirSync(this.inputDir)
      .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/i.test(name))
      .sort();
    return files.length ? path.join(this.inputDir, files[files.length - 1]) : null;
  }

  validateFinding(finding = {}) {
    const reasons = [];
    if (!clean(finding.id)) reasons.push('MISSING_ID');
    if (!clean(finding.competitor)) reasons.push('MISSING_COMPETITOR');
    if (!clean(finding.category)) reasons.push('MISSING_CATEGORY');
    if (this.rules?.governance?.source_url_required && !/^https?:\/\//i.test(clean(finding.source_url))) reasons.push('MISSING_OR_INVALID_SOURCE_URL');
    if (this.rules?.governance?.observation_date_required && !/^\d{4}-\d{2}-\d{2}$/.test(clean(finding.observed_at))) reasons.push('MISSING_OR_INVALID_OBSERVATION_DATE');
    if (!clean(finding.observation)) reasons.push('MISSING_OBSERVATION');
    if (!clean(finding.decision)) reasons.push('MISSING_DECISION');
    const confidence = finite(finding.confidence, -1);
    if (confidence < 0 || confidence > 1) reasons.push('INVALID_CONFIDENCE');
    const impact = finite(finding.impact_score, -1);
    if (impact < 0 || impact > 5) reasons.push('INVALID_IMPACT_SCORE');
    return { ok: reasons.length === 0, reasons };
  }

  blockedByGovernance(finding = {}) {
    const text = `${finding.observation || ''} ${finding.p2gc_action || ''} ${finding.experiment_hypothesis || ''}`.toLowerCase();
    const blocked = [];
    if (/guarantee|guaranteed|100% win|guaranteed award/.test(text)) blocked.push('UNSUPPORTED_GUARANTEE_RISK');
    if (/copy (their|competitor)|use competitor wording|clone/.test(text)) blocked.push('COMPETITOR_COPYING_RISK');
    if (upper(finding.experiment_variable) === 'PRICE_REDUCTION') blocked.push('PRICE_REDUCTION_REQUIRES_CEO_APPROVAL');
    return blocked;
  }

  experimentFromFinding(finding, index) {
    const minConfidence = finite(this.rules?.experiment_priority?.min_confidence, 0.7);
    const minImpact = finite(this.rules?.experiment_priority?.min_impact_score, 3);
    const decision = upper(finding.decision);
    const eligibleDecision = ['TEST', 'ADOPT_PRINCIPLE'].includes(decision);
    const confidence = finite(finding.confidence);
    const impact = finite(finding.impact_score);
    const variable = clean(finding.experiment_variable);
    const hypothesis = clean(finding.experiment_hypothesis);
    const governanceBlocks = this.blockedByGovernance(finding);

    if (!eligibleDecision || !variable || !hypothesis || confidence < minConfidence || impact < minImpact) return null;

    const needsApproval = variable === 'pricing_visibility';
    return {
      experiment_id: `P2GC-CI-${String(index + 1).padStart(3, '0')}-${finding.id}`,
      source_finding_id: finding.id,
      competitor: finding.competitor,
      category: finding.category,
      source_url: finding.source_url,
      observed_at: finding.observed_at,
      variable,
      hypothesis,
      proposed_action: finding.p2gc_action,
      test_design: {
        unit_of_test: 'pain_family_x_offer_x_segment',
        variables_changed: [variable],
        one_variable_only: true,
        control: 'CURRENT_P2GC_V2',
        treatment: `CURRENT_P2GC_V2_PLUS_${variable.toUpperCase()}`,
        primary_kpis: this.rules.experiment_kpis || [],
        promote_on: 'DOWNSTREAM_QUALIFIED_PIPELINE_AND_REVENUE',
        do_not_promote_on: 'OPEN_RATE_ONLY'
      },
      governance: {
        source_retained: true,
        competitor_claim_not_adopted_as_p2gc_proof: true,
        blocked_reasons: governanceBlocks,
        ceo_approval_required: needsApproval
      },
      status: governanceBlocks.length ? 'BLOCKED_GOVERNANCE' : (needsApproval ? 'AWAITING_CEO_APPROVAL' : 'READY_FOR_TEST')
    };
  }

  run(options = {}) {
    const snapshotPath = options.snapshotPath || this.latestSnapshotPath();
    const snapshot = options.snapshot || (snapshotPath ? readJson(snapshotPath, {}) : {});
    const findings = Array.isArray(snapshot.findings) ? snapshot.findings : [];
    const acceptedFindings = [];
    const rejectedFindings = [];

    findings.forEach(finding => {
      const validation = this.validateFinding(finding);
      if (validation.ok) acceptedFindings.push(finding);
      else rejectedFindings.push({ id: finding?.id || null, competitor: finding?.competitor || null, reasons: validation.reasons });
    });

    const candidates = acceptedFindings
      .map((finding, index) => this.experimentFromFinding(finding, index))
      .filter(Boolean);
    const maxOpen = finite(this.rules?.experiment_priority?.max_open_experiments, 6);
    const priorityRank = status => status === 'READY_FOR_TEST' ? 0 : status === 'AWAITING_CEO_APPROVAL' ? 1 : 2;
    candidates.sort((a, b) => priorityRank(a.status) - priorityRank(b.status));
    const experiments = candidates.slice(0, maxOpen);

    const report = {
      ok: Boolean(snapshot.review_date) && rejectedFindings.length === 0,
      service: 'P2GC_COMPETITOR_INTELLIGENCE_EXPERIMENT_ENGINE',
      generatedAt: new Date().toISOString(),
      reviewDate: snapshot.review_date || null,
      snapshotPath: snapshotPath || null,
      totals: {
        findingsObserved: findings.length,
        findingsAccepted: acceptedFindings.length,
        findingsRejected: rejectedFindings.length,
        experimentsCreated: experiments.length,
        readyForTest: experiments.filter(x => x.status === 'READY_FOR_TEST').length,
        awaitingCeoApproval: experiments.filter(x => x.status === 'AWAITING_CEO_APPROVAL').length,
        blocked: experiments.filter(x => x.status === 'BLOCKED_GOVERNANCE').length
      },
      rejectedFindings,
      experiments,
      governance: {
        sourceUrlRequired: true,
        observationDateRequired: true,
        oneVariablePerExperiment: true,
        competitorLanguageCopyingProhibited: true,
        competitorClaimsNotConvertedToP2gcProof: true,
        downstreamRevenueDecisionRule: true
      }
    };

    fs.mkdirSync(this.outputDir, { recursive: true });
    report.outputFile = path.join(this.outputDir, 'experiment_queue_latest.json');
    fs.writeFileSync(report.outputFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = P2GCCompetitorExperimentService;
module.exports.helpers = { readJson, clean, upper, finite };
