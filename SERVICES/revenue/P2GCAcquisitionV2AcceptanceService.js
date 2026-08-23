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

class P2GCAcquisitionV2AcceptanceService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
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

  run() {
    const checks = [];
    const proof = readJson(this.paths.proof, {});
    const proofCount = approvedProofCount(proof);
    checks.push(check('PROOF', 'Evidence-backed public proof library', proofCount >= 3 ? 'PASS' : 'PENDING_EVIDENCE', [this.paths.proof], { approvedPublicProofItems: proofCount, required: 3 }));

    const scorecard = readJson(this.paths.scorecard);
    checks.push(check('SCORECARD', 'Revenue-weighted campaign scorecard runtime', scorecard?.ok === true ? 'PASS' : 'PENDING_RUNTIME', [this.paths.scorecard], scorecard ? scorecard.totals : null));

    const nurture = readJson(this.paths.nurture);
    let nurtureStatus = 'PENDING_RUNTIME';
    if (nurture?.ok === true) {
      if (nurture.executeRequested === true) {
        const execution = nurture?.result?.execution;
        const report = nurture?.result?.report;
        if (Number(execution?.attempted || 0) === 0 && Number(report?.dueQueued || 0) === 0) nurtureStatus = 'PASS_NO_ACTION_REQUIRED';
        else if (execution?.ok === true && Number(execution?.executed || 0) === Number(execution?.attempted || 0)) nurtureStatus = 'PASS';
        else nurtureStatus = 'PENDING_EXTERNAL_MUTATION';
      } else nurtureStatus = 'PENDING_LIVE_EXECUTION';
    }
    checks.push(check('NURTURE', 'Qualified-prospect nurture runtime', nurtureStatus, [this.paths.nurture], nurture || null));

    const pathway = readJson(this.paths.pathway);
    checks.push(check('PATHWAY_SCORE', 'Integrated Federal Pathway Score live truth check', pathway?.ok === true ? 'PASS' : 'PENDING_NAMED_LIVE_EVALUATION', [this.paths.pathway], pathway ? { term: pathway.term, score: pathway.result?.score } : null));

    const pilot = readJson(this.paths.pilot);
    let pilotStatus = 'PENDING_RUNTIME';
    if (pilot?.ok === true) {
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
    checks.push(check('INSTANTLY_PILOT', 'Evidence-qualified Instantly V2 pilot deployment', pilotStatus, [this.paths.pilot], pilot || null));

    const b12 = readJson(this.paths.b12);
    const audit = readJson(this.paths.websiteAudit);
    let websiteStatus = 'PENDING_RUNTIME';
    if (audit?.ok === true) websiteStatus = 'PASS';
    else if (b12?.staging?.ok === true && b12?.publicPublishExecuted !== true) websiteStatus = 'PENDING_PUBLIC_PUBLISH';
    else if (b12?.status === 'AUTHENTICATED_B12_SESSION_REQUIRED') websiteStatus = 'PENDING_AUTHENTICATED_SESSION';
    else if (b12) websiteStatus = 'PENDING_STAGING_OR_PUBLIC_AUDIT';
    checks.push(check('WEBSITE', 'B12 conversion pages, homepage and legacy cleanup live', websiteStatus, [this.paths.b12, this.paths.websiteAudit], { b12: b12?.status || null, publicAuditOk: audit?.ok === true }));

    const authority = readJson(this.paths.authority);
    checks.push(check('AUTHORITY_QUEUE', 'Founder authority production queue', authority?.ok === true && Number(authority?.totals?.ready || 0) > 0 ? 'PASS' : 'PENDING_RUNTIME', [this.paths.authority], authority ? authority.totals : null));

    const buyerLens = readJson(this.paths.buyerLens);
    checks.push(check('BUYER_LENS', 'Buyer Lens current-news production queue', buyerLens?.ok === true && Number(buyerLens?.totals?.ready || 0) > 0 ? 'PASS' : 'PENDING_RUNTIME', [this.paths.buyerLens], buyerLens ? buyerLens.totals : null));

    const competitor = readJson(this.paths.competitor);
    checks.push(check('COMPETITOR_EXPERIMENTS', 'Competitor findings routed into governed experiments', competitor?.ok === true ? 'PASS' : 'PENDING_RUNTIME', [this.paths.competitor], competitor ? competitor.totals : null));

    const linkedin = readJson(this.paths.linkedin);
    let linkedinStatus = 'PENDING_CHANNEL_PUBLISHER';
    if (linkedin?.ok === true && linkedin?.mutationExecuted === true) linkedinStatus = 'PASS';
    else if (linkedin?.status === 'NO_DUE_READY_POST') linkedinStatus = 'PASS_NO_ACTION_REQUIRED';
    else if (linkedin?.status === 'AUTHENTICATED_LINKEDIN_SESSION_REQUIRED') linkedinStatus = 'PENDING_AUTHENTICATED_SESSION';
    checks.push(check('LINKEDIN', 'Founder/Buyer Lens LinkedIn publication path', linkedinStatus, [this.paths.linkedin], linkedin || null));

    const blocking = checks.filter(x => !x.complete);
    const report = {
      ok: blocking.length === 0,
      service: 'P2GC_ACQUISITION_V2_FINAL_ACCEPTANCE',
      generatedAt: new Date().toISOString(),
      status: blocking.length === 0 ? 'END_TO_END_ACCEPTED' : 'NOT_YET_END_TO_END_ACCEPTED',
      totals: {
        checks: checks.length,
        complete: checks.filter(x => x.complete).length,
        incomplete: blocking.length
      },
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
module.exports.helpers = { readJson, exists, clean, approvedProofCount, check };
