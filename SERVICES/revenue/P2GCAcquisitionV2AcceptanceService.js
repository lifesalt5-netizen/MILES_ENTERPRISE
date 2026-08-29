'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}
function exists(file) { return fs.existsSync(file); }
function clean(v) { return String(v || '').trim(); }
function approvedProofCount(registry = {}) {
  return [...(registry.approved || []), ...(registry.candidates || [])].filter(row =>
    clean(row.status).toUpperCase() === 'APPROVED' &&
    clean(row.public_use).toUpperCase() === 'APPROVED' &&
    !['', 'UNKNOWN', 'PENDING'].includes(clean(row.permission_status).toUpperCase())
  ).length;
}
function check(id, title, status, evidence = [], detail = null) {
  return { id, title, status, evidence, detail, complete: ['PASS','PASS_NO_ACTION_REQUIRED'].includes(status) };
}
function firstTimestamp(record = {}) {
  const candidates = [
    record.generatedAt, record.generated_at, record.updatedAt, record.updated_at,
    record.completedAt, record.completed_at, record.timestamp, record.runAt,
    record.result?.generatedAt, record.result?.generated_at,
    record.report?.generatedAt, record.report?.generated_at
  ];
  for (const value of candidates) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return { value, ms };
  }
  return null;
}
function freshness(record, nowMs, maxAgeMs) {
  if (!record) return { ok: false, reason: 'MISSING_EVIDENCE', timestamp: null, ageMs: null };
  const stamp = firstTimestamp(record);
  if (!stamp) return { ok: false, reason: 'UNDATED_EVIDENCE', timestamp: null, ageMs: null };
  const ageMs = nowMs - stamp.ms;
  if (ageMs < -5 * 60 * 1000) return { ok: false, reason: 'FUTURE_DATED_EVIDENCE', timestamp: stamp.value, ageMs };
  if (ageMs > maxAgeMs) return { ok: false, reason: 'STALE_EVIDENCE', timestamp: stamp.value, ageMs };
  return { ok: true, reason: 'FRESH', timestamp: stamp.value, ageMs };
}
function staleStatus(fresh) {
  if (!fresh || fresh.reason === 'MISSING_EVIDENCE') return 'PENDING_RUNTIME';
  if (fresh.reason === 'UNDATED_EVIDENCE') return 'PENDING_UNDATED_EVIDENCE';
  if (fresh.reason === 'FUTURE_DATED_EVIDENCE') return 'PENDING_INVALID_EVIDENCE_TIME';
  return 'PENDING_STALE_EVIDENCE';
}

class P2GCAcquisitionV2AcceptanceService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.now = options.now || (() => new Date());
    this.runtimeFreshnessMs = Number(options.runtimeFreshnessMs || process.env.P2GC_ACCEPTANCE_FRESHNESS_MS || 24 * 60 * 60 * 1000);
    this.paths = {
      proof: path.join(this.rootDir, 'DATA', 'marketing_coo', 'p2gc_proof_registry.json'),
      scorecard: path.join(this.rootDir, 'DATA', 'revenue_pipeline', 'latest_revenue_weighted_campaign_scorecard.json'),
      nurture: path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'nurture', 'run_once_latest.json'),
      pathway: path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'pathway_score', 'live_latest.json'),
      pilot: path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'p2gc_acquisition_v2', 'pilot_deployment_latest.json'),
      b12: path.join(this.rootDir, 'DATA', 'website_ops', 'b12_conversion_v2', 'latest.json'),
      websiteAudit: path.join(this.rootDir, 'DATA', 'website_ops', 'p2gc_conversion_audit', 'latest.json'),
      authority: path.join(this.rootDir, 'DATA', 'marketing_coo', 'authority_content', 'production_queue_latest.json'),
      buyerLens: path.join(this.rootDir, 'DATA', 'marketing_coo', 'buyer_lens_content', 'buyer_lens_queue_latest.json'),
      competitor: path.join(this.rootDir, 'DATA', 'marketing_coo', 'competitor_intelligence', 'experiment_queue_latest.json'),
      linkedin: path.join(this.rootDir, 'DATA', 'marketing_coo', 'linkedin_publish', 'latest.json')
    };
    this.outputDir = path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'p2gc_acquisition_v2');
  }

  fresh(record) {
    return freshness(record, this.now().getTime(), this.runtimeFreshnessMs);
  }

  run() {
    const checks = [];
    const proof = readJson(this.paths.proof, {});
    const proofCount = approvedProofCount(proof);
    checks.push(check('PROOF', 'Evidence-backed public proof library', proofCount >= 3 ? 'PASS' : 'PENDING_EVIDENCE', [this.paths.proof], { approvedPublicProofItems: proofCount, required: 3 }));

    const scorecard = readJson(this.paths.scorecard);
    const scorecardFresh = this.fresh(scorecard);
    checks.push(check('SCORECARD', 'Revenue-weighted campaign scorecard runtime', scorecard?.ok === true && scorecardFresh.ok ? 'PASS' : (scorecard?.ok === true ? staleStatus(scorecardFresh) : 'PENDING_RUNTIME'), [this.paths.scorecard], { totals: scorecard?.totals || null, freshness: scorecardFresh }));

    const nurture = readJson(this.paths.nurture);
    const nurtureFresh = this.fresh(nurture);
    let nurtureStatus = 'PENDING_RUNTIME';
    if (nurture?.ok === true && !nurtureFresh.ok) nurtureStatus = staleStatus(nurtureFresh);
    else if (nurture?.ok === true) {
      if (nurture.executeRequested === true) {
        const execution = nurture?.result?.execution;
        const report = nurture?.result?.report;
        if (Number(execution?.attempted || 0) === 0 && Number(report?.dueQueued || 0) === 0) nurtureStatus = 'PASS_NO_ACTION_REQUIRED';
        else if (execution?.ok === true && Number(execution?.executed || 0) === Number(execution?.attempted || 0)) nurtureStatus = 'PASS';
        else nurtureStatus = 'PENDING_EXTERNAL_MUTATION';
      } else nurtureStatus = 'PENDING_LIVE_EXECUTION';
    }
    checks.push(check('NURTURE', 'Qualified-prospect nurture runtime', nurtureStatus, [this.paths.nurture], { evidence: nurture || null, freshness: nurtureFresh }));

    const pathway = readJson(this.paths.pathway);
    const pathwayFresh = this.fresh(pathway);
    checks.push(check('PATHWAY_SCORE', 'Integrated Federal Pathway Score live truth check', pathway?.ok === true && pathwayFresh.ok ? 'PASS' : (pathway?.ok === true ? staleStatus(pathwayFresh) : 'PENDING_NAMED_LIVE_EVALUATION'), [this.paths.pathway], { term: pathway?.term || null, score: pathway?.result?.score || null, freshness: pathwayFresh }));

    const pilot = readJson(this.paths.pilot);
    const pilotFresh = this.fresh(pilot);
    let pilotStatus = 'PENDING_RUNTIME';
    if (pilot?.ok === true && !pilotFresh.ok) pilotStatus = staleStatus(pilotFresh);
    else if (pilot?.ok === true) {
      const accepted = Number(pilot?.enrichment?.accepted || 0);
      if (pilot.executeRequested === true) {
        if (accepted === 0) pilotStatus = 'PASS_NO_ACTION_REQUIRED';
        else if (pilot.executionTruth === 'EXTERNAL_MUTATION_CONFIRMED') {
          if (pilot.activationRequested === true) {
            const activations = (pilot.deployments || []).flatMap(x => x.actions || []).filter(x => x.action === 'activateCampaign');
            pilotStatus = activations.length && activations.every(x => ['EXECUTED','SKIPPED_EXISTING'].includes(x.status)) ? 'PASS' : 'PENDING_ACTIVATION';
          } else pilotStatus = 'PENDING_ACTIVATION';
        } else pilotStatus = 'PENDING_EXTERNAL_MUTATION';
      } else pilotStatus = 'PENDING_LIVE_EXECUTION';
    }
    checks.push(check('INSTANTLY_PILOT', 'Evidence-qualified Instantly V2 pilot deployment', pilotStatus, [this.paths.pilot], { evidence: pilot || null, freshness: pilotFresh }));

    const b12 = readJson(this.paths.b12);
    const audit = readJson(this.paths.websiteAudit);
    const b12Fresh = this.fresh(b12);
    const auditFresh = this.fresh(audit);
    let websiteStatus = 'PENDING_RUNTIME';
    if (audit?.ok === true && auditFresh.ok) websiteStatus = 'PASS';
    else if (audit?.ok === true && !auditFresh.ok) websiteStatus = staleStatus(auditFresh);
    else if (b12?.staging?.ok === true && b12?.publicPublishExecuted !== true && b12Fresh.ok) websiteStatus = 'PENDING_PUBLIC_PUBLISH';
    else if (b12?.status === 'AUTHENTICATED_B12_SESSION_REQUIRED' && b12Fresh.ok) websiteStatus = 'PENDING_AUTHENTICATED_SESSION';
    else if (b12 && !b12Fresh.ok) websiteStatus = staleStatus(b12Fresh);
    else if (b12) websiteStatus = 'PENDING_STAGING_OR_PUBLIC_AUDIT';
    checks.push(check('WEBSITE', 'B12 conversion pages, homepage and legacy cleanup live', websiteStatus, [this.paths.b12, this.paths.websiteAudit], { b12: b12?.status || null, publicAuditOk: audit?.ok === true, b12Freshness: b12Fresh, auditFreshness: auditFresh }));

    const authority = readJson(this.paths.authority);
    const authorityFresh = this.fresh(authority);
    checks.push(check('AUTHORITY_QUEUE', 'Founder authority production queue', authority?.ok === true && Number(authority?.totals?.ready || 0) > 0 && authorityFresh.ok ? 'PASS' : (authority?.ok === true && !authorityFresh.ok ? staleStatus(authorityFresh) : 'PENDING_RUNTIME'), [this.paths.authority], { totals: authority?.totals || null, freshness: authorityFresh }));

    const buyerLens = readJson(this.paths.buyerLens);
    const buyerLensFresh = this.fresh(buyerLens);
    checks.push(check('BUYER_LENS', 'Buyer Lens current-news production queue', buyerLens?.ok === true && Number(buyerLens?.totals?.ready || 0) > 0 && buyerLensFresh.ok ? 'PASS' : (buyerLens?.ok === true && !buyerLensFresh.ok ? staleStatus(buyerLensFresh) : 'PENDING_RUNTIME'), [this.paths.buyerLens], { totals: buyerLens?.totals || null, freshness: buyerLensFresh }));

    const competitor = readJson(this.paths.competitor);
    const competitorFresh = this.fresh(competitor);
    checks.push(check('COMPETITOR_EXPERIMENTS', 'Competitor findings routed into governed experiments', competitor?.ok === true && competitorFresh.ok ? 'PASS' : (competitor?.ok === true ? staleStatus(competitorFresh) : 'PENDING_RUNTIME'), [this.paths.competitor], { totals: competitor?.totals || null, freshness: competitorFresh }));

    const linkedin = readJson(this.paths.linkedin);
    const linkedinFresh = this.fresh(linkedin);
    let linkedinStatus = 'PENDING_CHANNEL_PUBLISHER';
    if (linkedin?.ok === true && !linkedinFresh.ok) linkedinStatus = staleStatus(linkedinFresh);
    else if (linkedin?.ok === true && linkedin?.mutationExecuted === true) linkedinStatus = 'PASS';
    else if (linkedin?.status === 'NO_DUE_READY_POST' && linkedinFresh.ok) linkedinStatus = 'PASS_NO_ACTION_REQUIRED';
    else if (linkedin?.status === 'AUTHENTICATED_LINKEDIN_SESSION_REQUIRED' && linkedinFresh.ok) linkedinStatus = 'PENDING_AUTHENTICATED_SESSION';
    checks.push(check('LINKEDIN', 'Founder/Buyer Lens LinkedIn publication path', linkedinStatus, [this.paths.linkedin], { evidence: linkedin || null, freshness: linkedinFresh }));

    const blocking = checks.filter(x => !x.complete);
    const report = {
      ok: blocking.length === 0,
      service: 'P2GC_ACQUISITION_V2_FINAL_ACCEPTANCE',
      generatedAt: new Date().toISOString(),
      acceptanceFreshnessMs: this.runtimeFreshnessMs,
      status: blocking.length === 0 ? 'END_TO_END_ACCEPTED' : 'NOT_YET_END_TO_END_ACCEPTED',
      totals: { checks: checks.length, complete: checks.filter(x => x.complete).length, incomplete: blocking.length },
      checks,
      blockers: blocking.map(x => ({ id: x.id, title: x.title, status: x.status }))
    };
    fs.mkdirSync(this.outputDir, { recursive: true });
    report.outputFile = path.join(this.outputDir, 'final_acceptance_latest.json');
    fs.writeFileSync(report.outputFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = P2GCAcquisitionV2AcceptanceService;
module.exports.helpers = { readJson, exists, clean, approvedProofCount, check, firstTimestamp, freshness, staleStatus };
