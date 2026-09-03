'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = String(process.env.P2GC_LIVE_DEMO_BASE_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
const TERM = String(process.env.P2GC_LIVE_DEMO_PROBE_TERM || 'Sera Brynn LLC').trim();
const REQUEST_TIMEOUT_MS = Math.max(10000, Number(process.env.P2GC_LIVE_DEMO_PROBE_TIMEOUT_MS || 180000));

function arr(value) { return Array.isArray(value) ? value : []; }
function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function unique(values) { return [...new Set(arr(values).map(clean).filter(Boolean))]; }

function requestJson(pathname) {
  const target = new URL(pathname, `${BASE_URL}/`);
  const client = target.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const req = client.get(target, { headers: { 'user-agent': 'MILES-Live-Canonical-Company-Probe' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch {}
        finish({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body, raw: raw.slice(-3000) });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`REQUEST_TIMEOUT_${REQUEST_TIMEOUT_MS}MS`)));
    req.on('error', error => finish({ ok: false, statusCode: null, body: null, error: error.message }));
  });
}

function duplicateCompanyNames(rows) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of arr(rows)) {
    const key = norm(row?.company);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(clean(row.company));
    seen.add(key);
  }
  return [...duplicates];
}

function summarize(model) {
  const profile = model?.profile || {};
  const state = model?.currentState || {};
  const awards = model?.awardHistory || {};
  const buyers = model?.buyerIntelligence || {};
  const opportunities = model?.opportunities || {};
  const gsaContracts = arr(profile.gsaContracts);
  const gsaCategories = unique(gsaContracts.flatMap(row => arr(row?.categories)));
  const live = arr(opportunities.liveAndForecast);
  const recompetes = arr(opportunities.recompetes);
  const duplicateCompetitors = duplicateCompanyNames(model?.competitors?.records);
  const duplicatePrimePartners = duplicateCompanyNames(model?.primePartners?.records);
  const zeroAwardPlaceholders = recompetes.filter(row => /ZERO_AWARD_VENDOR|ZERO AWARD VENDOR/i.test(JSON.stringify(row || {})));
  const sourceCoverage = model?.truthIntegrity?.sourceCoverage || {};

  const acceptanceFailures = [];
  if (model?.ok !== true) acceptanceFailures.push('ASSESSMENT_NOT_OK');
  if (!profile.uei) acceptanceFailures.push('UEI_MISSING');
  if (model?.truthIntegrity?.clientSafe !== true) acceptanceFailures.push(`TRUTH_NOT_CLIENT_SAFE:${model?.truthIntegrity?.status || 'UNKNOWN'}`);
  if (sourceCoverage.awardHistory !== true) acceptanceFailures.push('AUTHORITATIVE_AWARD_HISTORY_NOT_GREEN');
  if (sourceCoverage.gsaCurrent !== true) acceptanceFailures.push('CURRENT_GSA_TRUTH_NOT_GREEN');
  if (sourceCoverage.currentPublicOpportunities !== true) acceptanceFailures.push('CURRENT_PUBLIC_OPPORTUNITY_SOURCE_NOT_GREEN');
  if (state.activeContracts != null) acceptanceFailures.push('CLIENT_ACTIVE_CONTRACT_FIELD_MUST_REMAIN_UNCLAIMED');
  if (state.activeContractsStatus !== 'NOT_DERIVED_FROM_AWARD_COUNT') acceptanceFailures.push(`ACTIVE_CONTRACT_BOUNDARY_INVALID:${state.activeContractsStatus || 'MISSING'}`);
  if (profile.gsaHolderVerified === true && !gsaContracts.length) acceptanceFailures.push('GSA_HOLDER_WITHOUT_CONTRACT_DETAIL');
  if (profile.gsaHolderVerified === true && !gsaCategories.length) acceptanceFailures.push('GSA_HOLDER_WITHOUT_CATEGORY_OR_SIN_DETAIL');
  if (duplicateCompetitors.length) acceptanceFailures.push(`DUPLICATE_COMPETITORS:${duplicateCompetitors.join('|')}`);
  if (duplicatePrimePartners.length) acceptanceFailures.push(`DUPLICATE_PRIME_PARTNERS:${duplicatePrimePartners.join('|')}`);
  if (zeroAwardPlaceholders.length) acceptanceFailures.push('ZERO_AWARD_VENDOR_RECOMPETE_PLACEHOLDER_RENDERED');

  return {
    ok: acceptanceFailures.length === 0,
    status: acceptanceFailures.length ? 'LIVE_CANONICAL_COMPANY_PROBE_RED' : 'LIVE_CANONICAL_COMPANY_PROBE_GREEN',
    generatedAt: new Date().toISOString(),
    requestedTerm: TERM,
    identity: {
      companyName: profile.companyName || null,
      uei: profile.uei || null,
      cage: profile.cage || null,
      headquarters: profile.headquarters || null,
      samStatus: profile.samStatus || null,
      naicsCodes: arr(profile.naicsCodes),
      certifications: arr(profile.certifications)
    },
    truthIntegrity: {
      status: model?.truthIntegrity?.status || null,
      clientSafe: model?.truthIntegrity?.clientSafe === true,
      conflicts: arr(model?.truthIntegrity?.conflicts),
      blockers: arr(model?.truthIntegrity?.blockers),
      warnings: arr(model?.truthIntegrity?.warnings),
      sourceCoverage
    },
    awards: {
      status: awards.status || null,
      truthClass: awards.truthClass || null,
      summary: awards.summary || null,
      visiblePrimeAwards: arr(awards.primeAwards).slice(0, 5),
      visibleSubcontracts: arr(awards.subcontracts).slice(0, 5),
      currentPerformancePrimeAwardCount: state.currentPerformancePrimeAwardCount ?? awards?.summary?.activePrimeAwardCount ?? null,
      clientActiveContracts: state.activeContracts ?? null,
      clientActiveContractsStatus: state.activeContractsStatus || null
    },
    gsa: {
      status: profile.gsaStatus || null,
      evidenceStatus: profile.gsaEvidenceStatus || null,
      holderVerified: profile.gsaHolderVerified ?? null,
      contractNumbers: unique(gsaContracts.map(row => row?.contractNumber)),
      categoriesOrSins: gsaCategories,
      contracts: gsaContracts.map(row => ({
        contractNumber: row?.contractNumber || null,
        categories: arr(row?.categories),
        currentOptionPeriodEndDate: row?.currentOptionPeriodEndDate || null,
        ultimateContractEndDate: row?.ultimateContractEndDate || null,
        socioEconomicIndicators: row?.socioEconomicIndicators || null,
        sourceStatus: row?.sourceStatus || null,
        sourceUrl: row?.sourceUrl || null
      }))
    },
    buyers: {
      status: buyers.status || null,
      count: arr(buyers.records).length,
      records: arr(buyers.records).slice(0, 5)
    },
    opportunities: {
      sourceStatus: opportunities?.sourceCoverage?.status || null,
      sourceFresh: opportunities?.sourceCoverage?.fresh === true,
      count: live.length,
      top: live.slice(0, 5).map(row => ({
        title: row?.title || null,
        agency: row?.agency || null,
        stage: row?.stage || null,
        naics: row?.naics || null,
        setAside: row?.setAside || null,
        dueDate: row?.dueDate || null,
        fitScore: row?.fitScore ?? null,
        source: row?.source || null,
        sourceUrl: row?.sourceUrl || null
      })),
      recompeteCount: recompetes.length,
      zeroAwardPlaceholderCount: zeroAwardPlaceholders.length
    },
    revenue: {
      federal: model?.revenue?.current?.federal ?? null,
      federalStatus: model?.revenue?.current?.federalStatus || null,
      federalDefinition: model?.revenue?.current?.federalDefinition || null,
      measurementWindow: model?.revenue?.current?.measurementWindow || null,
      modeledPotentialFederalRevenue: model?.revenue?.opportunity?.modeledPotentialFederalRevenue ?? null,
      modeledGrowthOpportunity: model?.revenue?.opportunity?.modeledGrowthOpportunity ?? null,
      opportunityStatus: model?.revenue?.opportunity?.status || null
    },
    pathway: {
      type: model?.pathway?.type || null,
      title: model?.pathway?.title || null
    },
    quality: {
      duplicateCompetitors,
      duplicatePrimePartners,
      zeroAwardVendorPlaceholderRendered: zeroAwardPlaceholders.length > 0,
      clientActiveContractTruthBoundaryPreserved: state.activeContracts == null && state.activeContractsStatus === 'NOT_DERIVED_FROM_AWARD_COUNT'
    },
    acceptanceFailures,
    safety: {
      localhostReadOnlyHttp: true,
      oneCanonicalRefresh: true,
      externalWrites: false,
      campaignsMutated: false,
      dnsMutated: false,
      credentialsMutated: false,
      customerDataMutated: false
    }
  };
}

async function main() {
  const response = await requestJson(`/api/assessment?term=${encodeURIComponent(TERM)}&refresh=1`);
  if (!response.ok || !response.body) {
    const failure = {
      ok: false,
      status: 'LIVE_CANONICAL_COMPANY_PROBE_HTTP_FAILURE',
      requestedTerm: TERM,
      statusCode: response.statusCode,
      error: response.error || response.raw || null,
      safety: { localhostReadOnlyHttp: true, externalWrites: false }
    };
    console.log('LIVE_CANONICAL_COMPANY_PROBE_RESULT');
    console.log(JSON.stringify(failure, null, 2));
    process.exitCode = 2;
    return;
  }
  const report = summarize(response.body);
  console.log('LIVE_CANONICAL_COMPANY_PROBE_RESULT');
  console.log(JSON.stringify(report, null, 2));
  console.log(`RESULT: ${report.status}`);
  if (!report.ok) process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message);
  console.log('RESULT: LIVE_CANONICAL_COMPANY_PROBE_RED');
  process.exitCode = 1;
});

module.exports = { BASE_URL, TERM, REQUEST_TIMEOUT_MS, requestJson, duplicateCompanyNames, summarize };
