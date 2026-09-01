'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = String(process.env.P2GC_LIVE_DEMO_BASE_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS || 20000));
const DEFAULT_COMPANIES = [
  'DeLune Corporation',
  'Dreamers Inc.',
  'GO Logistics Courier Services LLC',
  'Integrated Technology Partners Corporation',
  'Sera Brynn LLC'
];

function companyList() {
  const configured = String(process.env.P2GC_LIVE_DEMO_AUDIT_COMPANIES || '').trim();
  return configured
    ? configured.split('|').map(x => x.trim()).filter(Boolean)
    : DEFAULT_COMPANIES;
}

function requestJson(pathname) {
  const target = new URL(pathname, `${BASE_URL}/`);
  const client = target.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = client.get(target, { headers: { 'user-agent': 'MILES-Live-Demo-Acceptance' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch {}
        finish({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body, raw: raw.slice(-2000) });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`REQUEST_TIMEOUT_${REQUEST_TIMEOUT_MS}MS`)));
    req.on('error', error => finish({ ok: false, statusCode: null, body: null, error: error.message }));
  });
}

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value == null ? '' : value).trim(); }
function addFailure(failures, code, detail = null) { failures.push(detail ? `${code}:${detail}` : code); }

function validateAssessment(body, failures) {
  if (!body || body.ok !== true) addFailure(failures, 'ASSESSMENT_NOT_OK');
  if (!text(body?.profile?.companyName)) addFailure(failures, 'COMPANY_IDENTITY_MISSING');
  const integrity = body?.truthIntegrity;
  if (!integrity) addFailure(failures, 'TRUTH_INTEGRITY_MISSING');
  if (integrity && integrity.clientSafe !== true) addFailure(failures, 'TRUTH_INTEGRITY_NOT_CLIENT_SAFE', integrity.status || 'UNKNOWN');
  if (arr(integrity?.conflicts).length) addFailure(failures, 'TRUTH_CONFLICTS_PRESENT', arr(integrity.conflicts).join(','));
  if (!body?.evidence?.truthIntegrity) addFailure(failures, 'TRUTH_PROVENANCE_MISSING');
  if (body?.currentState?.activeContracts != null) addFailure(failures, 'ACTIVE_CONTRACTS_UNVERIFIED_NON_NULL');
  if (body?.currentState?.activeContractsStatus && body.currentState.activeContractsStatus !== 'NOT_DERIVED_FROM_AWARD_COUNT') {
    addFailure(failures, 'ACTIVE_CONTRACT_STATUS_UNEXPECTED', body.currentState.activeContractsStatus);
  }
}

function validateOpportunities(body, failures) {
  if (!body || body.ok !== true || body.type !== 'opportunities') addFailure(failures, 'OPPORTUNITY_VIEW_NOT_OK');
  const markets = arr(body?.taxonomy?.markets);
  const stages = arr(body?.taxonomy?.stages);
  for (const required of ['FEDERAL', 'SLED', 'LOCAL']) if (!markets.includes(required)) addFailure(failures, 'OPPORTUNITY_MARKET_TAXONOMY_MISSING', required);
  for (const required of ['OPEN','RFI','SOURCES_SOUGHT','PRESOLICITATION','DRAFT','FORECAST','RECOMPETE','RECENT_SIMILAR_AWARD','SPECIAL_NOTICE']) {
    if (!stages.includes(required)) addFailure(failures, 'OPPORTUNITY_STAGE_TAXONOMY_MISSING', required);
  }
  if (!body?.sourceAccessGovernance) addFailure(failures, 'SOURCE_ACCESS_GOVERNANCE_MISSING');
  if (body?.opportunityRules?.bypassAuthentication !== false) addFailure(failures, 'AUTH_BYPASS_POLICY_NOT_FALSE');
  if (body?.opportunityRules?.bypassAccessControls !== false) addFailure(failures, 'ACCESS_CONTROL_BYPASS_POLICY_NOT_FALSE');

  const records = arr(body?.records);
  if (!records.length) {
    if (body?.status !== 'NO_CURRENT_MATCHED_OPPORTUNITY_SIGNAL') addFailure(failures, 'EMPTY_OPPORTUNITY_VIEW_NOT_EXPLICIT_NO_FIT', body?.status || 'UNKNOWN');
    if (body?.universalStatus !== 'NO_QUALIFIED_PUBLIC_OPPORTUNITY_OR_HISTORY_SIGNAL') addFailure(failures, 'EMPTY_UNIVERSAL_INDEX_NOT_EXPLICIT_COVERAGE_STATE', body?.universalStatus || 'UNKNOWN');
  }
  for (const row of records) {
    if (!text(row.title)) addFailure(failures, 'OPPORTUNITY_TITLE_MISSING');
    if (!['FEDERAL','SLED','LOCAL'].includes(row.market)) addFailure(failures, 'OPPORTUNITY_MARKET_INVALID', row.market || 'EMPTY');
    if (!text(row.stage)) addFailure(failures, 'OPPORTUNITY_STAGE_MISSING');
    if (!text(row.evidenceLane)) addFailure(failures, 'OPPORTUNITY_EVIDENCE_LANE_MISSING');
    if (row.restricted === true) addFailure(failures, 'RESTRICTED_RECORD_EXPOSED_IN_PROSPECT_DEMO', row.title || row.id || 'UNKNOWN');
  }
}

function validateVehicles(body, failures) {
  if (!body || body.ok !== true || body.type !== 'vehicles') addFailure(failures, 'VEHICLE_VIEW_NOT_OK');
  const vehicles = arr(body?.currentVehicles);
  if (!vehicles.length && !['VEHICLE_STATUS_UNCONFIRMED','NO_CURRENT_VEHICLE_IDENTIFIED'].includes(body?.status)) {
    addFailure(failures, 'EMPTY_VEHICLE_VIEW_NOT_EXPLICIT', body?.status || 'UNKNOWN');
  }
}

function validateRecompetes(body, failures) {
  if (!body || body.ok !== true || body.type !== 'recompetes') addFailure(failures, 'RECOMPETE_VIEW_NOT_OK');
  if (!arr(body?.records).length && body?.status !== 'NO_CURRENT_RECOMPETE_SIGNAL') {
    addFailure(failures, 'EMPTY_RECOMPETE_VIEW_NOT_EXPLICIT', body?.status || 'UNKNOWN');
  }
  if (body?.currentCapability?.incumbentIdentity === true && !arr(body?.records).some(row => text(row?.incumbent))) {
    addFailure(failures, 'INCUMBENT_CAPABILITY_CLAIM_WITHOUT_EVIDENCE');
  }
}

function validateTeaming(body, failures) {
  if (!body || body.ok !== true) addFailure(failures, 'TEAMING_VIEW_NOT_OK');
  if (body?.safety?.readOnly !== true || body?.safety?.writesEnabled !== false || body?.safety?.contactsInvented !== false) {
    addFailure(failures, 'TEAMING_SAFETY_CONTRACT_INVALID');
  }
  for (const prime of arr(body?.primeCandidates)) {
    if (!text(prime.company)) addFailure(failures, 'PRIME_CANDIDATE_COMPANY_MISSING');
    if (prime?.contact?.status === 'UNAVAILABLE_IN_CURRENT_ORION_RECORD' && (prime?.contact?.email || prime?.contact?.phone || prime?.contact?.sblo)) {
      addFailure(failures, 'TEAMING_CONTACT_INVENTED', prime.company || 'UNKNOWN');
    }
  }
  if (!arr(body?.primeCandidates).length && !['TEAMING_INTELLIGENCE_LIMITED','TEAMING_INTELLIGENCE_READY'].includes(body?.status)) {
    addFailure(failures, 'TEAMING_EMPTY_STATE_INVALID', body?.status || 'UNKNOWN');
  }
}

async function auditCompany(term) {
  const encoded = encodeURIComponent(term);
  const failures = [];
  const assessment = await requestJson(`/api/assessment?term=${encoded}&refresh=1`);
  if (!assessment.ok) addFailure(failures, 'ASSESSMENT_HTTP_FAILURE', `${assessment.statusCode || 'ERR'}:${assessment.error || assessment.raw || ''}`);
  else validateAssessment(assessment.body, failures);

  const opportunities = await requestJson(`/api/intelligence?term=${encoded}&type=opportunities&refresh=1`);
  if (!opportunities.ok) addFailure(failures, 'OPPORTUNITY_HTTP_FAILURE', `${opportunities.statusCode || 'ERR'}:${opportunities.error || opportunities.raw || ''}`);
  else validateOpportunities(opportunities.body, failures);

  const vehicles = await requestJson(`/api/intelligence?term=${encoded}&type=vehicles&refresh=1`);
  if (!vehicles.ok) addFailure(failures, 'VEHICLE_HTTP_FAILURE', `${vehicles.statusCode || 'ERR'}:${vehicles.error || vehicles.raw || ''}`);
  else validateVehicles(vehicles.body, failures);

  const recompetes = await requestJson(`/api/intelligence?term=${encoded}&type=recompetes&refresh=1`);
  if (!recompetes.ok) addFailure(failures, 'RECOMPETE_HTTP_FAILURE', `${recompetes.statusCode || 'ERR'}:${recompetes.error || recompetes.raw || ''}`);
  else validateRecompetes(recompetes.body, failures);

  const teaming = await requestJson(`/api/teaming?term=${encoded}&refresh=1`);
  if (!teaming.ok) addFailure(failures, 'TEAMING_HTTP_FAILURE', `${teaming.statusCode || 'ERR'}:${teaming.error || teaming.raw || ''}`);
  else validateTeaming(teaming.body, failures);

  return {
    requestedTerm: term,
    resolvedCompany: assessment.body?.profile?.companyName || null,
    ok: failures.length === 0,
    failures,
    truthStatus: assessment.body?.truthIntegrity?.status || null,
    opportunityStatus: opportunities.body?.status || null,
    opportunityTotal: Number(opportunities.body?.totals?.all || 0),
    vehicleStatus: vehicles.body?.status || null,
    currentVehicleCount: arr(vehicles.body?.currentVehicles).length,
    recompeteStatus: recompetes.body?.status || null,
    recompeteCount: arr(recompetes.body?.records).length,
    teamingStatus: teaming.body?.status || null,
    primeCandidateCount: arr(teaming.body?.primeCandidates).length,
    currentTeamingSignalCount: arr(teaming.body?.subcontractingOpportunities?.records).length
  };
}

async function main() {
  console.log('============================================================');
  console.log('P2GC LIVE PRODUCTION DEMO SEMANTIC ACCEPTANCE');
  console.log('============================================================');
  console.log(`Base URL: ${BASE_URL}`);

  const health = await requestJson('/api/health');
  const healthFailures = [];
  if (!health.ok || health.body?.ok !== true) addFailure(healthFailures, 'DEMO_HEALTH_NOT_OK', health.error || health.raw || String(health.statusCode));
  for (const capability of ['truth_reconciliation','prime_sub_teaming','opportunity_intelligence','vehicle_intelligence','recompete_intelligence']) {
    if (!arr(health.body?.capabilities).includes(capability)) addFailure(healthFailures, 'DEMO_CAPABILITY_MISSING', capability);
  }

  const companies = companyList();
  const results = [];
  for (const company of companies) results.push(await auditCompany(company));

  const failedCompanies = results.filter(row => !row.ok);
  const report = {
    ok: healthFailures.length === 0 && failedCompanies.length === 0,
    status: healthFailures.length === 0 && failedCompanies.length === 0 ? 'LIVE_DEMO_ACCEPTANCE_GREEN' : 'LIVE_DEMO_ACCEPTANCE_RED',
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    health: { ok: healthFailures.length === 0, failures: healthFailures, service: health.body?.service || null },
    companyCount: results.length,
    passedCompanyCount: results.length - failedCompanies.length,
    failedCompanyCount: failedCompanies.length,
    results,
    safety: { readOnly: true, prospectSends: false, externalWrites: false, authBypass: false }
  };

  console.log('LIVE_DEMO_ACCEPTANCE_RESULT');
  console.log(JSON.stringify(report, null, 2));
  console.log(`RESULT: ${report.status}`);
  if (!report.ok) process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message);
  console.log('RESULT: LIVE_DEMO_ACCEPTANCE_RED');
  process.exitCode = 1;
});

module.exports = {
  BASE_URL,
  DEFAULT_COMPANIES,
  companyList,
  requestJson,
  validateAssessment,
  validateOpportunities,
  validateVehicles,
  validateRecompetes,
  validateTeaming,
  auditCompany
};
