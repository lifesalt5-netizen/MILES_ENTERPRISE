'use strict';

const fs = require('fs');
const path = require('path');

function s(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function lower(value) { return s(value).toLowerCase(); }
function compact(value) { return lower(value).replace(/[^a-z0-9]/g, ''); }
function normalizeDomain(value) {
  return lower(value).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}
function domainFromEmail(value) {
  const email = lower(value);
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : '';
}
function uniq(values) { return [...new Set((values || []).map(s).filter(Boolean))]; }

const PHASE1_LANES = new Set([
  'STATE_PROVEN_FEDERAL_READY',
  'SAM_REGISTERED_NO_OR_LOW_FEDERAL_REVENUE',
  'FORMER_GSA_NO_SALES / FAILED_ACTIVATION',
  'FEDERAL_SUB_TO_PRIME_READY',
  'COMMERCIAL_SUCCESS_WITH_GOVERNMENT_ENTRY_INTENT'
]);

class MonicaDiscoveryCandidateService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.assessmentPath = options.assessmentPath || path.join(this.root, 'CONFIG', 'MONICA', 'monica_discovery_assessment.json');
    this.registryPath = options.registryPath || path.join(this.root, 'CONFIG', 'MONICA', 'monica_source_registry.json');
  }

  loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

  sourceMap() {
    const registry = this.loadJson(this.registryPath);
    return new Map((registry.sources || []).map(row => [row.id, row]));
  }

  companyKey(row = {}) {
    const uei = compact(row.uei || row.UEI || row.uniqueEntityId);
    if (uei) return `UEI:${uei}`;
    const domain = normalizeDomain(row.domain || row.website || domainFromEmail(row.email || row.contactEmail));
    if (domain) return `DOMAIN:${domain}`;
    const name = compact(row.companyName || row.legalName || row.businessName || row.name);
    const state = compact(row.state || row.locationState || row.location);
    return name ? `NAME:${name}|STATE:${state}` : '';
  }

  evidenceQuality(row = {}, source = {}) {
    let score = 0;
    const evidence = row.sourceEvidence || {};
    if (s(row.uei || row.UEI)) score += 2;
    if (normalizeDomain(row.domain || row.website)) score += 1;
    if (s(evidence.awardId || row.awardId || row.contractNumber || row.purchaseOrder)) score += 3;
    if (s(evidence.registrationId || row.registrationId || row.certificationId)) score += 1;
    if (s(row.procurementIntentSignal || source.intentSignal)) score += 1;
    if (row.federalGapEvidence && typeof row.federalGapEvidence === 'object' && Object.keys(row.federalGapEvidence).length) score += 2;
    if (s(row.provenanceUrl || row.sourceUrl || evidence.url)) score += 1;
    if (score >= 7) return 'HIGH';
    if (score >= 4) return 'MEDIUM';
    return 'LOW';
  }

  normalize(raw = {}) {
    const sources = this.sourceMap();
    const sourceId = s(raw.sourceId);
    const source = sources.get(sourceId);
    if (!source) throw new Error(`MONICA_UNKNOWN_SOURCE:${sourceId || 'MISSING'}`);

    const lane = s(raw.lane);
    if (!PHASE1_LANES.has(lane) || !(source.laneFit || []).includes(lane)) {
      throw new Error(`MONICA_INVALID_LANE_SOURCE:${lane || 'MISSING'}:${sourceId}`);
    }

    const companyName = s(raw.companyName || raw.legalName || raw.businessName || raw.name);
    const domain = normalizeDomain(raw.domain || raw.website || domainFromEmail(raw.email || raw.contactEmail));
    const key = this.companyKey({ ...raw, companyName, domain });
    if (!key || !companyName) throw new Error('MONICA_CANDIDATE_IDENTITY_REQUIRED');

    const sourceEvidence = raw.sourceEvidence && typeof raw.sourceEvidence === 'object' ? raw.sourceEvidence : {};
    const federalGapEvidence = raw.federalGapEvidence && typeof raw.federalGapEvidence === 'object' ? raw.federalGapEvidence : {};
    const provenanceUrl = s(raw.provenanceUrl || raw.sourceUrl || sourceEvidence.url);
    if (!provenanceUrl) throw new Error('MONICA_PROVENANCE_REQUIRED');

    const suppressionStatus = s(raw.suppressionStatus || 'UNKNOWN').toUpperCase();
    const allowedSuppression = new Set(['UNKNOWN','CLEAR','SUPPRESSED_CLIENT','SUPPRESSED_ACTIVE_OPPORTUNITY','SUPPRESSED_OPTOUT','SUPPRESSED_DUPLICATE','SUPPRESSED_INVALID']);
    if (!allowedSuppression.has(suppressionStatus)) throw new Error(`MONICA_INVALID_SUPPRESSION_STATUS:${suppressionStatus}`);

    const normalized = {
      candidateKey: key,
      companyName,
      normalizedCompanyName: lower(companyName).replace(/[^a-z0-9]+/g, ' ').trim(),
      uei: s(raw.uei || raw.UEI),
      domain,
      location: s(raw.location || [raw.city, raw.state].filter(Boolean).join(', ')),
      naics: uniq(Array.isArray(raw.naics) ? raw.naics : s(raw.naics).split(/[;|,]/)),
      certifications: uniq(Array.isArray(raw.certifications) ? raw.certifications : s(raw.certifications).split(/[;|,]/)),
      sourceId,
      sourceFamily: source.sourceFamily,
      sourceEvidence,
      procurementIntentSignal: s(raw.procurementIntentSignal || source.intentSignal),
      federalGapEvidence,
      lane,
      qualificationConfidence: this.evidenceQuality(raw, source),
      suppressionStatus,
      contactabilityStatus: s(raw.contactabilityStatus || 'NOT_EVALUATED').toUpperCase(),
      provenance: {
        url: provenanceUrl,
        sourceId,
        sourceFamily: source.sourceFamily,
        observedAt: s(raw.observedAt || raw.harvestedAt || new Date().toISOString())
      },
      outreachEligible: false,
      campaignEnrollmentEligible: false,
      discoveryOnly: true
    };

    return normalized;
  }

  dedupe(rows = []) {
    const map = new Map();
    for (const raw of rows) {
      const row = this.normalize(raw);
      const prior = map.get(row.candidateKey);
      if (!prior) { map.set(row.candidateKey, row); continue; }
      const rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
      const chosen = rank[row.qualificationConfidence] > rank[prior.qualificationConfidence] ? row : prior;
      const merged = {
        ...chosen,
        sourceIds: uniq([...(prior.sourceIds || [prior.sourceId]), ...(row.sourceIds || [row.sourceId])]),
        sourceFamilies: uniq([...(prior.sourceFamilies || [prior.sourceFamily]), ...(row.sourceFamilies || [row.sourceFamily])])
      };
      map.set(row.candidateKey, merged);
    }
    return [...map.values()];
  }

  measure(rows = []) {
    const normalized = this.dedupe(rows);
    const assessment = this.loadJson(this.assessmentPath);
    const result = {};
    for (const lane of assessment.phase1Lanes || []) {
      const subset = normalized.filter(r => r.lane === lane.lane);
      const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
      for (const row of subset) counts[row.qualificationConfidence] += 1;
      result[lane.lane] = {
        candidateCount: subset.length,
        candidateCountStatus: 'MEASURED_FROM_PROVENANCE_BACKED_HARVEST',
        evidenceQualityCounts: counts,
        suppressedCount: subset.filter(r => r.suppressionStatus !== 'CLEAR').length,
        contactableCount: subset.filter(r => r.suppressionStatus === 'CLEAR' && r.contactabilityStatus === 'CONTACTABLE').length,
        outreachBlocked: true,
        campaignEnrollmentBlocked: true
      };
    }
    return { mode: 'DISCOVERY_ONLY', rows: normalized, lanes: result };
  }
}

module.exports = MonicaDiscoveryCandidateService;
module.exports.PHASE1_LANES = PHASE1_LANES;
