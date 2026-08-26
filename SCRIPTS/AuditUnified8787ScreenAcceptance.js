'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
const PORT = Number(process.env.MILES_UNIFIED_PORT || 8787);
const OUT_DIR = path.join(ROOT, 'DATA', 'operational_acceptance', 'unified_8787_screen_acceptance');

function request(route, options = {}) {
  return new Promise(resolve => {
    const payload = options.body == null ? null : JSON.stringify(options.body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: route,
      method: options.method || 'GET',
      timeout: options.timeoutMs || 30000,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, text, json });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0, error: 'TIMEOUT', text: '' }); });
    req.on('error', error => resolve({ ok: false, statusCode: 0, error: error.message, text: '' }));
    if (payload) req.write(payload);
    req.end();
  });
}

function result(results, name, pass, details = {}) {
  const status = pass ? 'GREEN' : 'RED';
  results.push({ name, status, ...details });
  console.log(`${name}: ${status}${details.reason ? ` - ${details.reason}` : ''}`);
}

function discoverCompany() {
  try {
    const connector = require(path.join(ROOT, 'CONNECTORS', 'ORION', 'connector'));
    const init = connector.initialize();
    if (!init?.ok) return null;
    const rows = connector.query("SELECT company, uei FROM contractors WHERE company IS NOT NULL AND TRIM(company) <> '' ORDER BY COALESCE(federal_revenue,0) DESC LIMIT 1");
    return rows?.[0]?.uei || rows?.[0]?.company || null;
  } catch {
    return null;
  }
}

function has(text, pattern) {
  return pattern instanceof RegExp ? pattern.test(text || '') : String(text || '').includes(pattern);
}

async function main() {
  const results = [];
  console.log('============================================================');
  console.log('MILES UNIFIED 8787 SCREEN ACCEPTANCE - LIVE / READ ONLY');
  console.log('============================================================');

  const pageContracts = [
    ['dashboard', '/', /MILES Executive Dashboard/],
    ['growth_blueprint', '/demo', /Executive Government Growth Blueprint/],
    ['sub2prime', '/teaming', /Sub2Prime/],
    ['opportunities', '/opportunities', /Opportunity Intelligence/],
    ['vehicles', '/vehicles', /Vehicle Intelligence|Contract Vehicle Intelligence/],
    ['recompetes', '/recompetes', /Recompete Intelligence/],
    ['proposal_command', '/proposal-command', /Proposal Command/],
    ['miles_execution', '/execution', /Miles Command Center/],
    ['legacy_diagnostics', '/legacy', /MILES|Dashboard|Diagnostics/i]
  ];

  for (const [name, route, pattern] of pageContracts) {
    const response = await request(route);
    result(results, `${name}_page`, response.ok && has(response.text, pattern), {
      route,
      statusCode: response.statusCode,
      reason: response.error || null
    });
  }

  const state = await request('/api/state');
  result(results, 'dashboard_state_api', state.ok && state.json && typeof state.json === 'object', {
    statusCode: state.statusCode,
    companyHealth: state.json?.executiveSummary?.companyHealthScore ?? null,
    runtime: state.json?.executiveSummary?.runtimeStatus ?? state.json?.cooRuntime?.runtimeHealthStatus ?? null
  });

  const brief = await request('/api/brief');
  result(results, 'daily_10k_brief_api', brief.ok && brief.json && Array.isArray(brief.json.topActions), {
    statusCode: brief.statusCode,
    briefStatus: brief.json?.scorecard?.status || null,
    revenue: brief.json?.scorecard?.currentRevenue ?? null,
    pipeline: brief.json?.scorecard?.pipeline ?? null
  });

  const health = await request('/api/health');
  result(results, 'unified_gateway_health_api', health.ok && health.json?.service === 'MILES_UNIFIED_CEO_GATEWAY' && health.json?.status === 'HEALTHY', {
    statusCode: health.statusCode,
    backendStatus: health.json?.status || null,
    upstreams: health.json?.upstreams || null
  });

  const conversation = await request('/api/command', {
    method: 'POST',
    body: {
      command: 'What is working with the emails and what is not? Analyze how to get more meetings using current evidence only. Do not send, modify, activate, pause, delete, publish, submit, or write anything.'
    },
    timeoutMs: 120000
  });
  const conversationText = conversation.json?.message || conversation.json?.response?.message || '';
  result(results, 'miles_evidence_backed_conversation', conversation.ok && conversation.json?.conversation === true && /Email \/ meeting analysis/i.test(conversationText) && /Best plan to get more meetings/i.test(conversationText), {
    statusCode: conversation.statusCode,
    backendStatus: conversation.json?.status || null
  });

  const revenue = await request('/api/revenue');
  result(results, 'customer_revenue_operations_api', revenue.ok && revenue.json?.ok === true && revenue.json?.metrics && typeof revenue.json.metrics.pipelineValue === 'number', {
    statusCode: revenue.statusCode,
    pipelineValue: revenue.json?.metrics?.pipelineValue ?? null,
    meetingsBooked: revenue.json?.metrics?.meetingsBooked ?? null,
    activeClients: revenue.json?.metrics?.activeClients ?? null
  });

  const customerHealth = await request('/api/customer-health');
  result(results, 'customer_health_api', customerHealth.ok && customerHealth.json?.ok === true, {
    statusCode: customerHealth.statusCode,
    backendStatus: customerHealth.json?.status || null
  });

  const clients = await request('/api/clients');
  result(results, 'clients_api', clients.ok && clients.json != null, { statusCode: clients.statusCode });

  const prospects = await request('/api/prospects');
  result(results, 'prospects_api', prospects.ok && prospects.json != null, { statusCode: prospects.statusCode });

  const company = String(process.env.MILES_ACCEPTANCE_COMPANY || '').trim() || discoverCompany();
  result(results, 'representative_orion_company', Boolean(company), { company: company || null });

  if (company) {
    const encoded = encodeURIComponent(company);
    const assessment = await request(`/api/assessment?term=${encoded}`, { timeoutMs: 120000 });
    result(results, 'growth_blueprint_semantic_result', assessment.ok && assessment.json?.ok === true && Boolean(assessment.json?.profile?.companyName) && Boolean(assessment.json?.readiness), {
      statusCode: assessment.statusCode,
      company: assessment.json?.profile?.companyName || company,
      readiness: assessment.json?.readiness?.overall ?? null
    });

    const teaming = await request(`/api/teaming?term=${encoded}`, { timeoutMs: 120000 });
    const contactsInvented = teaming.json?.safety?.contactsInvented;
    result(results, 'sub2prime_semantic_result', teaming.ok && teaming.json?.ok === true && contactsInvented === false && Array.isArray(teaming.json?.primeCandidates), {
      statusCode: teaming.statusCode,
      primeCandidates: teaming.json?.primeCandidates?.length ?? null,
      contactsInvented
    });

    for (const type of ['opportunities','vehicles','recompetes']) {
      const focused = await request(`/api/intelligence?type=${type}&term=${encoded}`, { timeoutMs: 120000 });
      const truthful = focused.ok && focused.json?.ok === true && focused.json?.type === type && typeof focused.json?.disclosure === 'string';
      const failClosed = type !== 'recompetes' || focused.json?.currentCapability?.incumbentIdentity !== true || Array.isArray(focused.json?.records);
      result(results, `${type}_semantic_result`, truthful && failClosed, {
        statusCode: focused.statusCode,
        backendStatus: focused.json?.status || null,
        recordCount: Array.isArray(focused.json?.records) ? focused.json.records.length : null
      });
    }
  }

  const proposalHealth = await request('/api/proposal-command/health');
  result(results, 'proposal_command_health', proposalHealth.ok && proposalHealth.json?.ok !== false, {
    statusCode: proposalHealth.statusCode,
    backendStatus: proposalHealth.json?.status || null
  });

  const dashboardHtml = await request('/');
  result(results, 'unified_dashboard_hides_internal_ports', dashboardHtml.ok && !/127\.0\.0\.1:(8791|8792|8737|8788)/.test(dashboardHtml.text) && /href="\/execution"/.test(dashboardHtml.text), {
    statusCode: dashboardHtml.statusCode
  });

  const passed = results.every(item => item.status === 'GREEN');
  const report = {
    ok: passed,
    status: passed ? 'UNIFIED_8787_SCREEN_ACCEPTANCE_GREEN' : 'UNIFIED_8787_SCREEN_ACCEPTANCE_RED',
    readOnly: true,
    port: PORT,
    company: company || null,
    results,
    generatedAt: new Date().toISOString()
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const reportFile = path.join(OUT_DIR, 'latest.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${reportFile}`);
  console.log(`RESULT: ${report.status}`);
  process.exitCode = passed ? 0 : 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
