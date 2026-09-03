'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
const BASE_URL = String(process.env.P2GC_LIVE_DEMO_BASE_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS || 20000));
const DEMO_PM2_NAME = 'p2gc-growth-demo';
const DEMO_SOURCE_FILES = Object.freeze([
  'StartP2GCGrowthBlueprintDemo.js',
  'SERVICES/demo/ExecutiveGrowthBlueprintDemoService.js',
  'SERVICES/demo/DemoTruthReconciliationService.js',
  'SERVICES/demo/ExecutiveBlueprintCanonicalTruthService.js',
  'SERVICES/demo/DemoCommercialPreviewService.js',
  'SERVICES/demo/DemoUnifiedOpportunityService.js',
  'SERVICES/demo/P2GCFocusedIntelligenceService.js',
  'SERVICES/demo/CurrentPublicOpportunityMatchService.js',
  'SERVICES/demo/HistoricalProspectFallbackService.js',
  'SERVICES/demo/HistoricalRecipientNameIndexService.js',
  'SERVICES/demo/CompanyIdentityCanonicalizer.js',
  'SERVICES/demo/public/app.js',
  'SERVICES/teaming/P2GCPrimeSubTeamingService.js'
]);
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

function runPm2(args = []) {
  const shell = process.env.ComSpec || 'cmd.exe';
  return spawnSync(shell, ['/d', '/s', '/c', 'pm2.cmd', ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000
  });
}

function latestDemoSourceMtimeMs() {
  let latest = 0;
  for (const rel of DEMO_SOURCE_FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    latest = Math.max(latest, fs.statSync(file).mtimeMs);
  }
  return latest;
}

function parsePm2List(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function waitForCurrentDemoHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await requestJson('/api/health');
    const capabilities = Array.isArray(last.body?.capabilities) ? last.body.capabilities : [];
    if (last.ok && last.body?.ok === true && capabilities.includes('truth_reconciliation')) return last;
    await new Promise(resolve => setTimeout(resolve, 1250));
  }
  return last || { ok: false, error: 'DEMO_HEALTH_TIMEOUT' };
}

async function ensureDemoCurrent() {
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true, reason: 'WINDOWS_ONLY_PM2_RELOAD', restartPerformed: false };
  }

  const listed = runPm2(['jlist']);
  if (listed.status !== 0) {
    return { ok: false, status: 'PM2_LIST_FAILED', restartPerformed: false, exitCode: listed.status, stderr: String(listed.stderr || '').slice(-3000) };
  }
  const apps = parsePm2List(listed.stdout);
  const app = apps.find(item => String(item?.name || item?.pm2_env?.name || '') === DEMO_PM2_NAME);
  if (!app) return { ok: false, status: 'P2GC_GROWTH_DEMO_PM2_NOT_FOUND', restartPerformed: false };

  const pm2Status = String(app?.pm2_env?.status || '').toLowerCase();
  const processStartedMs = Number(app?.pm2_env?.pm_uptime || 0);
  const latestSourceMs = latestDemoSourceMtimeMs();
  const sourceNewer = latestSourceMs > 0 && (!Number.isFinite(processStartedMs) || processStartedMs <= 0 || latestSourceMs > processStartedMs + 1000);
  const restartRequired = pm2Status !== 'online' || sourceNewer;

  if (!restartRequired) {
    const health = await waitForCurrentDemoHealth(10000);
    return {
      ok: health.ok === true && health.body?.ok === true,
      status: 'CURRENT_NO_RESTART', restartPerformed: false, pm2Status, pid: app.pid || null,
      processStartedAt: processStartedMs > 0 ? new Date(processStartedMs).toISOString() : null,
      latestSourceModifiedAt: latestSourceMs > 0 ? new Date(latestSourceMs).toISOString() : null, health
    };
  }

  const restarted = runPm2(['restart', DEMO_PM2_NAME, '--update-env']);
  if (restarted.status !== 0) {
    return { ok: false, status: 'P2GC_GROWTH_DEMO_RESTART_FAILED', restartPerformed: true, sourceNewer, exitCode: restarted.status, stderr: String(restarted.stderr || '').slice(-4000) };
  }

  const health = await waitForCurrentDemoHealth();
  return {
    ok: health.ok === true && health.body?.ok === true && Array.isArray(health.body?.capabilities) && health.body.capabilities.includes('truth_reconciliation'),
    status: health.ok && health.body?.capabilities?.includes('truth_reconciliation') ? 'RESTARTED_AND_CURRENT' : 'RESTARTED_BUT_CURRENT_HEALTH_NOT_PROVEN',
    restartPerformed: true, restartTarget: DEMO_PM2_NAME, sourceNewer, previousPid: app.pid || null, previousPm2Status: pm2Status,
    previousProcessStartedAt: processStartedMs > 0 ? new Date(processStartedMs).toISOString() : null,
    latestSourceModifiedAt: latestSourceMs > 0 ? new Date(latestSourceMs).toISOString() : null, health
  };
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

  const state = body?.currentState || {};
  const awardHistory = body?.awardHistory || {};
  const active = state.activeContracts;
  const activeStatus = text(state.activeContractsStatus);
  if (active != null) {
    const n = Number(active);
    if (!Number.isInteger(n) || n < 0) addFailure(failures, 'ACTIVE_CONTRACT_COUNT_INVALID', String(active));
    if (activeStatus !== 'CONFIRMED_CURRENT_PERFORMANCE_PERIOD_FROM_USASPENDING_DATES') addFailure(failures, 'ACTIVE_CONTRACTS_NON_NULL_WITHOUT_AUTHORITATIVE_STATUS', activeStatus || 'EMPTY');
    if (awardHistory.truthClass !== 'CONFIRMED') addFailure(failures, 'ACTIVE_CONTRACTS_WITHOUT_CONFIRMED_AWARD_HISTORY');
    if (arr(awardHistory.activePrimeAwards).length !== n) addFailure(failures, 'ACTIVE_CONTRACT_COUNT_DOES_NOT_MATCH_ACTIVE_AWARD_ROWS', `${n}:${arr(awardHistory.activePrimeAwards).length}`);
  } else if (activeStatus && !['NOT_DERIVED_FROM_AWARD_COUNT','UNVERIFIED'].includes(activeStatus)) {
    addFailure(failures, 'NULL_ACTIVE_CONTRACT_STATUS_UNEXPECTED', activeStatus);
  }

  const federal = state.federalSales;
  const federalStatus = text(state.federalSalesStatus || body?.revenue?.current?.federalStatus);
  if (federal === 0) {
    if (federalStatus !== 'ZERO_PERMITTED_BY_AUTHORITATIVE_ZERO_AWARD_HISTORY') addFailure(failures, 'FEDERAL_ZERO_WITHOUT_AUTHORITATIVE_ZERO_CLASSIFICATION', federalStatus || 'EMPTY');
    if (awardHistory.truthClass !== 'CONFIRMED' || Number(awardHistory?.summary?.awardCount) !== 0) addFailure(failures, 'FEDERAL_ZERO_WITHOUT_CONFIRMED_ZERO_AWARD_HISTORY');
  }

  for (const field of ['state','local','commercial']) {
    const value=body?.revenue?.current?.[field];
    const status=text(body?.revenue?.current?.[`${field}Status`]);
    if (value===0 && !/CONFIRMED|AUTHORITATIVE|ZERO_PERMITTED/i.test(status)) addFailure(failures,'UNVERIFIED_NONFEDERAL_ZERO',field);
  }

  if (body?.pathway?.type === 'FIRST_AWARD_PATHWAY') {
    if (awardHistory.truthClass !== 'CONFIRMED' || Number(awardHistory?.summary?.awardCount) !== 0) addFailure(failures, 'FIRST_AWARD_PATHWAY_WITHOUT_CONFIRMED_ZERO_AWARD_HISTORY');
  }

  const coverage = integrity?.sourceCoverage;
  if (coverage) {
    for (const required of ['identity','awardHistory','gsaCurrent','currentPublicOpportunities']) {
      if (coverage[required] !== true) addFailure(failures, 'CANONICAL_SOURCE_COVERAGE_NOT_GREEN', required);
    }
    if (coverage.sam !== true) {
      const samUnknown=state.samRegistration==null && /UNVERIFIED|UNKNOWN|NOT CONFIRMED/i.test(text(body?.profile?.samStatus));
      if (!samUnknown) addFailure(failures,'SAM_COVERAGE_MISSING_WITHOUT_EXPLICIT_UNKNOWN');
    }
  }

  const preview=body?.commercialPreview;
  if (!preview?.totals) addFailure(failures,'COMMERCIAL_PROOF_TOTALS_MISSING');
  for (const key of ['opportunities','primePartners','recompetes','buyers','competitors','vehicles']) {
    if (!preview?.[key]) continue;
    if (Number(preview?.totals?.[key]?.total) !== Number(preview[key].totalKnown)) addFailure(failures,'PROOF_TOTAL_MISMATCH',key);
    if (Number(preview[key].visibleCount||0)+Number(preview[key].lockedCount||0)!==Number(preview[key].totalKnown||0)) addFailure(failures,'PROOF_VISIBILITY_TOTAL_MISMATCH',key);
  }

  const opps=arr(body?.opportunities?.liveAndForecast);
  const seen=new Set();
  for (const row of opps) {
    const key=text(row.noticeId||row.id||row.solicitationNumber)||`${text(row.agency)}|${text(row.title)}|${text(row.dueDate)}`;
    if (seen.has(key)) addFailure(failures,'DUPLICATE_OPPORTUNITY',key);
    seen.add(key);
    if (row.directPursuitEligible===false && Number(row.fitScore)>49) addFailure(failures,'INELIGIBLE_SET_ASIDE_FIT_TOO_HIGH',String(row.fitScore));
  }

  const recommendationText=Object.values(body?.recommendations||{}).flatMap(arr).join(' | ');
  if (body?.profile?.gsaHolderVerified===true && /vehicle gap contractor|primary growth driver:\s*vehicle gap/i.test(recommendationText)) addFailure(failures,'GSA_HOLDER_HAS_VEHICLE_GAP_RECOMMENDATION');
  if (body?.revenue?.opportunity?.modeledGrowthOpportunity==null && /revenue leakage estimate|commercial pain point.*\$/i.test(recommendationText)) addFailure(failures,'UNSUPPORTED_REVENUE_LEAKAGE_RECOMMENDATION');
  if (!arr(body?.opportunities?.recompetes).length && /prioriti[sz]e .*recompete|incumbent-displacement signal/i.test(recommendationText)) addFailure(failures,'RECOMPETE_RECOMMENDATION_WITHOUT_SIGNAL');
}

function validateOpportunities(body, failures) {
  if (!body || body.ok !== true || body.type !== 'opportunities') addFailure(failures, 'OPPORTUNITY_VIEW_NOT_OK');
  const markets = arr(body?.taxonomy?.markets);
  const stages = arr(body?.taxonomy?.stages);
  for (const required of ['FEDERAL', 'SLED', 'LOCAL']) if (!markets.includes(required)) addFailure(failures, 'OPPORTUNITY_MARKET_TAXONOMY_MISSING', required);
  for (const required of ['OPEN','RFI','SOURCES_SOUGHT','PRESOLICITATION','DRAFT','FORECAST','RECOMPETE','RECENT_SIMILAR_AWARD','SPECIAL_NOTICE']) if (!stages.includes(required)) addFailure(failures, 'OPPORTUNITY_STAGE_TAXONOMY_MISSING', required);
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
  if (!vehicles.length && !['VEHICLE_STATUS_UNCONFIRMED','NO_CURRENT_VEHICLE_IDENTIFIED'].includes(body?.status)) addFailure(failures, 'EMPTY_VEHICLE_VIEW_NOT_EXPLICIT', body?.status || 'UNKNOWN');
}

function validateRecompetes(body, failures) {
  if (!body || body.ok !== true || body.type !== 'recompetes') addFailure(failures, 'RECOMPETE_VIEW_NOT_OK');
  if (!arr(body?.records).length && body?.status !== 'NO_CURRENT_RECOMPETE_SIGNAL') addFailure(failures, 'EMPTY_RECOMPETE_VIEW_NOT_EXPLICIT', body?.status || 'UNKNOWN');
  if (body?.currentCapability?.incumbentIdentity === true && !arr(body?.records).some(row => text(row?.incumbent))) addFailure(failures, 'INCUMBENT_CAPABILITY_CLAIM_WITHOUT_EVIDENCE');
}

function validateTeaming(body, failures) {
  if (!body || body.ok !== true) addFailure(failures, 'TEAMING_VIEW_NOT_OK');
  if (body?.safety?.readOnly !== true || body?.safety?.writesEnabled !== false || body?.safety?.contactsInvented !== false) addFailure(failures, 'TEAMING_SAFETY_CONTRACT_INVALID');
  for (const prime of arr(body?.primeCandidates)) {
    if (!text(prime.company)) addFailure(failures, 'PRIME_CANDIDATE_COMPANY_MISSING');
    if (prime?.contact?.status === 'UNAVAILABLE_IN_CURRENT_ORION_RECORD' && (prime?.contact?.email || prime?.contact?.phone || prime?.contact?.sblo)) addFailure(failures, 'TEAMING_CONTACT_INVENTED', prime.company || 'UNKNOWN');
  }
  if (!arr(body?.primeCandidates).length && !['TEAMING_INTELLIGENCE_LIMITED','TEAMING_INTELLIGENCE_READY'].includes(body?.status)) addFailure(failures, 'TEAMING_EMPTY_STATE_INVALID', body?.status || 'UNKNOWN');
}

async function auditCompany(term) {
  const encoded = encodeURIComponent(term);
  const failures = [];
  const assessment = await requestJson(`/api/assessment?term=${encoded}&refresh=1`);
  if (!assessment.ok) addFailure(failures, 'ASSESSMENT_HTTP_FAILURE', `${assessment.statusCode || 'ERR'}:${assessment.error || assessment.raw || ''}`);
  else validateAssessment(assessment.body, failures);

  const opportunities = await requestJson(`/api/intelligence?term=${encoded}&type=opportunities`);
  if (!opportunities.ok) addFailure(failures, 'OPPORTUNITY_HTTP_FAILURE', `${opportunities.statusCode || 'ERR'}:${opportunities.error || opportunities.raw || ''}`);
  else validateOpportunities(opportunities.body, failures);

  const vehicles = await requestJson(`/api/intelligence?term=${encoded}&type=vehicles`);
  if (!vehicles.ok) addFailure(failures, 'VEHICLE_HTTP_FAILURE', `${vehicles.statusCode || 'ERR'}:${vehicles.error || vehicles.raw || ''}`);
  else validateVehicles(vehicles.body, failures);

  const recompetes = await requestJson(`/api/intelligence?term=${encoded}&type=recompetes`);
  if (!recompetes.ok) addFailure(failures, 'RECOMPETE_HTTP_FAILURE', `${recompetes.statusCode || 'ERR'}:${recompetes.error || recompetes.raw || ''}`);
  else validateRecompetes(recompetes.body, failures);

  const teaming = await requestJson(`/api/teaming?term=${encoded}`);
  if (!teaming.ok) addFailure(failures, 'TEAMING_HTTP_FAILURE', `${teaming.statusCode || 'ERR'}:${teaming.error || teaming.raw || ''}`);
  else validateTeaming(teaming.body, failures);

  return {
    requestedTerm: term, resolvedCompany: assessment.body?.profile?.companyName || null, ok: failures.length === 0, failures,
    truthStatus: assessment.body?.truthIntegrity?.status || null,
    opportunityStatus: opportunities.body?.status || null, opportunityTotal: Number(opportunities.body?.totals?.all || 0),
    vehicleStatus: vehicles.body?.status || null, currentVehicleCount: arr(vehicles.body?.currentVehicles).length,
    recompeteStatus: recompetes.body?.status || null, recompeteCount: arr(recompetes.body?.records).length,
    teamingStatus: teaming.body?.status || null, primeCandidateCount: arr(teaming.body?.primeCandidates).length,
    currentTeamingSignalCount: arr(teaming.body?.subcontractingOpportunities?.records).length
  };
}

async function main() {
  console.log('============================================================');
  console.log('P2GC LIVE PRODUCTION DEMO SEMANTIC ACCEPTANCE');
  console.log('============================================================');
  console.log(`Base URL: ${BASE_URL}`);

  const runtimeReload = await ensureDemoCurrent();
  console.log('LIVE_DEMO_RUNTIME_CURRENCY');
  console.log(JSON.stringify(runtimeReload, null, 2));

  const health = runtimeReload.health || await requestJson('/api/health');
  const healthFailures = [];
  if (runtimeReload.ok !== true) addFailure(healthFailures, 'DEMO_RUNTIME_NOT_CURRENT', runtimeReload.status || runtimeReload.reason || 'UNKNOWN');
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
    generatedAt: new Date().toISOString(), baseUrl: BASE_URL, runtimeReload,
    health: { ok: healthFailures.length === 0, failures: healthFailures, service: health.body?.service || null },
    companyCount: results.length, passedCompanyCount: results.length - failedCompanies.length, failedCompanyCount: failedCompanies.length, results,
    safety: { dataReadOnly: true, prospectSends: false, externalWrites: false, authBypass: false, processRestartOnlyWhenSourceNewerOrOffline: true, restartTargetAllowlisted: DEMO_PM2_NAME, oneCanonicalRefreshPerCompany: true }
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
  ROOT, BASE_URL, DEMO_PM2_NAME, DEMO_SOURCE_FILES, DEFAULT_COMPANIES, companyList, requestJson, latestDemoSourceMtimeMs,
  parsePm2List, waitForCurrentDemoHealth, ensureDemoCurrent, validateAssessment, validateOpportunities, validateVehicles,
  validateRecompetes, validateTeaming, auditCompany
};