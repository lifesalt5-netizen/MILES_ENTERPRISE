'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function isoNow() { return new Date().toISOString(); }
function norm(v) { return String(v || '').trim().toUpperCase(); }
function artifactPath(manifest, basename) {
  const item = (manifest?.artifacts || []).find(a => path.basename(a.filePath || '') === basename);
  return item?.filePath || null;
}
async function loadJsonlMap(filePath, keyFn) {
  const map = new Map();
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const key = keyFn(row);
    if (key) map.set(key, row);
  }
  return map;
}
function parseDate(value) {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? null : d;
}
function daysUntil(value, now) {
  const d = parseDate(value);
  return d ? Math.ceil((d - now) / 86400000) : null;
}
function salesBand(value) {
  const n = Math.max(0, Number(value || 0));
  if (n === 0) return 'GSA_NO_SALES';
  if (n < 100000) return 'GSA_0_100K';
  if (n < 500000) return 'GSA_100K_500K';
  if (n < 1000000) return 'GSA_500K_1M';
  if (n < 3000000) return 'GSA_1M_3M';
  if (n < 5000000) return 'GSA_3M_5M';
  return 'GSA_5M_PLUS';
}
function currentHolderPathFromManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const p = artifactPath(manifest, 'gsa_current_mas_holders.jsonl');
  if (!p || !fs.existsSync(p)) throw new Error('Current GSA holder artifact not found.');
  return p;
}
async function loadNewHolderKeys(reconciliationReportPath) {
  const out = new Set();
  if (!reconciliationReportPath || !fs.existsSync(reconciliationReportPath)) return out;
  const report = JSON.parse(fs.readFileSync(reconciliationReportPath, 'utf8'));
  const changeArtifact = (report.artifacts || []).find(a => path.basename(a.filePath || '') === 'gsa_holder_changes.jsonl');
  if (!changeArtifact?.filePath || !fs.existsSync(changeArtifact.filePath)) return out;
  const input = fs.createReadStream(changeArtifact.filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.type === 'NEW_HOLDER') out.add(norm(row.key));
  }
  return out;
}

class GsaSalesSegmentationService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.outputRoot = path.join(this.rootDir, 'DATA', 'staging', 'government_data', 'gsa_segmentation');
  }

  async run(options = {}) {
    const holderManifestPath = path.resolve(options.holderManifestPath || '');
    const awardAggregatePath = path.resolve(options.awardAggregatePath || '');
    if (!holderManifestPath || !fs.existsSync(holderManifestPath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'GSA_HOLDER_MANIFEST_NOT_FOUND' };
    }
    if (!awardAggregatePath || !fs.existsSync(awardAggregatePath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'AWARD_AGGREGATES_NOT_FOUND' };
    }

    const holderPath = currentHolderPathFromManifest(holderManifestPath);
    const awardsByUei = await loadJsonlMap(awardAggregatePath, row => norm(row.uei));
    const newHolderKeys = await loadNewHolderKeys(options.reconciliationReportPath ? path.resolve(options.reconciliationReportPath) : null);
    const now = options.now ? new Date(options.now) : new Date();

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const runId = `GSA-SEG-${isoNow().replace(/[:.]/g, '-')}`;
    const runRoot = path.join(this.outputRoot, runId);
    fs.mkdirSync(runRoot, { recursive: false });
    const segmentedPath = path.join(runRoot, 'gsa_segmented_current_holders.jsonl');
    const campaignReadyPath = path.join(runRoot, 'gsa_campaign_ready_staging.jsonl');
    const segmented = fs.createWriteStream(segmentedPath, { flags: 'wx' });
    const campaignReady = fs.createWriteStream(campaignReadyPath, { flags: 'wx' });

    const counts = { holders: 0, withUei: 0, withFederalAwardEvidence: 0, campaignReady: 0, contactVerificationRequired: 0, segments: {} };
    const input = fs.createReadStream(holderPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      counts.holders += 1;
      const holder = JSON.parse(line);
      const uei = norm(holder.uei);
      if (uei) counts.withUei += 1;
      const awards = uei ? awardsByUei.get(uei) : null;
      if (awards) counts.withFederalAwardEvidence += 1;

      const contractNumber = norm(holder.contractNumber);
      const refs = awards?.contractRefs || {};
      const gsaLinkedObligations = contractNumber ? Number(refs[contractNumber] || 0) : 0;
      const totalFederalObligations = Number(awards?.primeFederalObligations || 0);
      const federalOutsideGsa = Math.max(0, totalFederalObligations - gsaLinkedObligations);
      const tags = new Set([salesBand(gsaLinkedObligations)]);
      const expiryDays = daysUntil(holder.ultimateContractEndDate || holder.currentOptionPeriodEndDate, now);
      const identity = contractNumber || uei || norm(holder.legalBusinessName);

      if (newHolderKeys.has(identity) && gsaLinkedObligations <= 0) tags.add('GSA_NEW_NO_ACTIVATION');
      if (gsaLinkedObligations < 100000) tags.add('GSA_LOW_UTILIZATION');
      if (expiryDays !== null && expiryDays >= 0 && expiryDays <= 183) tags.add('GSA_EXPIRING_6M');
      else if (expiryDays !== null && expiryDays >= 0 && expiryDays <= 365) tags.add('GSA_EXPIRING_12M');
      if (federalOutsideGsa >= 100000 && gsaLinkedObligations < 100000) tags.add('GSA_FEDERAL_SUCCESS_OUTSIDE_GSA');
      if (Number(awards?.topAgencyShare || 0) >= 0.75 && totalFederalObligations >= 100000) tags.add('GSA_HIGH_AGENCY_CONCENTRATION');
      if ((Array.isArray(holder.categories) ? holder.categories.length : 0) >= 2 && gsaLinkedObligations < 500000) tags.add('GSA_UNDERUTILIZED_CAPABILITY');
      if (federalOutsideGsa >= 500000 && gsaLinkedObligations < 500000) tags.add('GSA_EXPANSION_CANDIDATE');

      // Declining requires a comparable prior-period sales measure. Do not infer it from one window.
      const notEvaluated = ['GSA_DECLINING'];
      const email = String(holder.sourceEmail || '').trim().toLowerCase();
      const emailSyntaxValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      const verifiedContact = holder.verifiedEmail === true || holder.emailVerificationStatus === 'VERIFIED';
      const isCampaignReady = Boolean(uei && emailSyntaxValid && verifiedContact);
      if (isCampaignReady) counts.campaignReady += 1;
      else counts.contactVerificationRequired += 1;

      for (const tag of tags) counts.segments[tag] = Number(counts.segments[tag] || 0) + 1;
      const record = {
        source: 'GSA_CURRENT_MAS_PLUS_USASPENDING',
        uei: holder.uei || null,
        contractNumber: holder.contractNumber || null,
        legalBusinessName: holder.legalBusinessName || null,
        categories: holder.categories || [],
        expirationDate: holder.ultimateContractEndDate || holder.currentOptionPeriodEndDate || null,
        salesEvidence: {
          measurementWindow: options.measurementWindow || null,
          gsaScheduleLinkedFederalObligations: gsaLinkedObligations,
          totalPrimeFederalObligations: totalFederalObligations,
          federalObligationsOutsideGsaLinkage: federalOutsideGsa,
          topAwardingAgency: awards?.topAwardingAgency || null,
          topAgencyShare: Number(awards?.topAgencyShare || 0)
        },
        segments: Array.from(tags).sort(),
        notEvaluated,
        contactReadiness: {
          email: emailSyntaxValid ? email : null,
          verified: verifiedContact,
          campaignReady: isCampaignReady,
          reason: isCampaignReady ? 'VERIFIED_CONTACT_PRESENT' : 'VERIFIED_CONTACT_REQUIRED'
        },
        safety: { stagingOnly: true, instantlyPushAuthorized: false }
      };
      segmented.write(`${JSON.stringify(record)}\n`);
      if (isCampaignReady) campaignReady.write(`${JSON.stringify(record)}\n`);
    }

    await Promise.all([
      new Promise(resolve => segmented.end(resolve)),
      new Promise(resolve => campaignReady.end(resolve))
    ]);

    const report = {
      ok: true,
      status: 'COMPLETED',
      service: 'GsaSalesSegmentationService',
      generatedAt: isoNow(),
      inputs: { holderManifestPath, holderPath, awardAggregatePath, reconciliationReportPath: options.reconciliationReportPath || null },
      counts,
      methodology: {
        gsaSalesProxy: 'USAspending prime obligations whose PIID or parent award ID exactly matches the current GSA schedule contract number',
        federalOutsideGsa: 'Prime federal obligations for the same UEI minus exact schedule-linked obligations',
        decliningSegment: 'NOT_EVALUATED_WITHOUT_COMPARABLE_PRIOR_PERIOD',
        campaignReadyRequiresVerifiedContact: true
      },
      artifacts: [
        { filePath: segmentedPath, bytes: fs.statSync(segmentedPath).size },
        { filePath: campaignReadyPath, bytes: fs.statSync(campaignReadyPath).size }
      ],
      safety: { stagingOnly: true, instantlyModified: false, productionOrionModified: false }
    };
    const reportPath = path.join(runRoot, 'segmentation_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return { ...report, reportPath, segmentedPath, campaignReadyPath };
  }
}

module.exports = GsaSalesSegmentationService;
module.exports.salesBand = salesBand;
