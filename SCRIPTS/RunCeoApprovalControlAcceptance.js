'use strict';

const http = require('http');

function request({ port, path, method = 'GET', payload = null, timeoutMs = 10000 }) {
  return new Promise(resolve => {
    const body = payload == null ? null : JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      timeout: timeoutMs,
      headers: body ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      } : undefined
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          json,
          text: json ? null : text
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', error => resolve({ ok: false, statusCode: 0, error: error.message, json: null, text: null }));
    if (body) req.write(body);
    req.end();
  });
}

function pendingApprovals(dashboard) {
  const allowed = new Set(['AWAITING_APPROVAL','WAITING_FOR_CEO_APPROVAL','AWAITING_CEO_APPROVAL']);
  return Array.isArray(dashboard?.operations)
    ? dashboard.operations.filter(item => allowed.has(String(item?.status || '').toUpperCase()))
    : [];
}

function statusFrom(response) {
  return response?.json?.status || null;
}

async function main() {
  const fakeId = '__MILES_ACCEPTANCE_NONEXISTENT_OPERATION__';

  const health = await request({ port: 8787, path: '/api/health' });
  const dashboardBefore = await request({ port: 8787, path: '/api/dashboard' });
  const rootHtml = await request({ port: 8787, path: '/' });
  const ceoJs = await request({ port: 8787, path: '/ceo.js' });
  const executionHtml = await request({ port: 8787, path: '/execution' });
  const desktopStatus = await request({ port: 3737, path: '/api/status' });

  const beforePending = pendingApprovals(dashboardBefore.json);
  const runtimeBacklog = Number(dashboardBefore.json?.taskQueue?.awaitingApproval || 0);

  const requestChangesProbe = await request({
    port: 8787,
    path: `/api/operations/${encodeURIComponent(fakeId)}/request-changes`,
    method: 'POST',
    payload: { instructions: 'Acceptance probe only; nonexistent operation; do not mutate anything.' }
  });
  const approveProbe = await request({
    port: 8787,
    path: `/api/operations/${encodeURIComponent(fakeId)}/approve`,
    method: 'POST',
    payload: { reason: 'Acceptance probe only.' }
  });
  const rejectProbe = await request({
    port: 8787,
    path: `/api/operations/${encodeURIComponent(fakeId)}/reject`,
    method: 'POST',
    payload: { reason: 'Acceptance probe only.' }
  });

  const dashboardAfter = await request({ port: 8787, path: '/api/dashboard' });
  const afterPending = pendingApprovals(dashboardAfter.json);
  const fakeAppeared = Array.isArray(dashboardAfter.json?.operations)
    && dashboardAfter.json.operations.some(item => String(item?.id || '') === fakeId);

  const js = String(ceoJs.text || '');
  const html = String(rootHtml.text || '');
  const execution = String(executionHtml.text || '');

  const checks = {
    unifiedHealth: health.ok && health.json?.service === 'MILES_UNIFIED_CEO_GATEWAY',
    dashboardReadable: dashboardBefore.ok && dashboardBefore.json?.service === 'MILES_COMMAND_CENTER',
    canonicalPendingStable: beforePending.length === afterPending.length,
    fakeProbeDidNotCreateOperation: !fakeAppeared,
    requestChangesRouteLive: requestChangesProbe.statusCode === 400 && statusFrom(requestChangesProbe) === 'NOT_FOUND',
    approveRouteLive: approveProbe.statusCode === 400 && ['NOT_FOUND','INVALID_STATUS'].includes(String(statusFrom(approveProbe) || '')),
    rejectRouteLive: rejectProbe.statusCode === 400 && String(statusFrom(rejectProbe) || '') === 'NOT_FOUND',
    liveRootUsesCeoDashboard: rootHtml.ok && html.includes('MILES Executive Dashboard') && html.includes('/ceo.js'),
    liveCeoJsUsesCanonicalApprovals: ceoJs.ok && js.includes('canonicalPendingFromDashboard') && js.includes('Canonical CEO decisions'),
    liveCeoJsSeparatesRuntimeBacklog: js.includes('Worker runtime approval backlog') && js.includes('not counted as Kevin approvals'),
    liveCeoJsHasAllDecisionControls: js.includes('data-approval-action="approve"') && js.includes('data-approval-action="request-changes"') && js.includes('data-approval-action="reject"'),
    executionSurfaceReachable: executionHtml.ok && execution.length > 100,
    desktopUsesCanonicalApprovalControl: desktopStatus.ok && desktopStatus.json?.approvalControl?.canonical === true,
    desktopCanonicalCountMatches: desktopStatus.ok && Number(desktopStatus.json?.approvalControl?.count || 0) === beforePending.length
  };

  const failedChecks = Object.entries(checks).filter(([,value]) => value !== true).map(([key]) => key);
  const proof = {
    ok: failedChecks.length === 0,
    service: 'MILES_CEO_APPROVAL_CONTROL_ACCEPTANCE',
    observedAt: new Date().toISOString(),
    canonical: {
      pendingBefore: beforePending.length,
      pendingAfter: afterPending.length,
      pendingIds: beforePending.map(item => item.id),
      workerRuntimeAwaitingApproval: runtimeBacklog,
      workerRuntimeSource: dashboardBefore.json?.taskQueue?.source || null
    },
    routes: {
      requestChanges: { http: requestChangesProbe.statusCode, status: statusFrom(requestChangesProbe) },
      approve: { http: approveProbe.statusCode, status: statusFrom(approveProbe) },
      reject: { http: rejectProbe.statusCode, status: statusFrom(rejectProbe) }
    },
    surfaces: {
      root8787: rootHtml.statusCode,
      execution8787: executionHtml.statusCode,
      desktop3737: desktopStatus.statusCode
    },
    checks,
    failedChecks,
    safety: {
      nonexistentOperationProbeOnly: true,
      approvalRecordsCreated: false,
      providerMutation: false,
      campaignMutation: false,
      emailSent: false,
      destructiveAction: false
    }
  };

  console.log('MILES_CEO_APPROVAL_CONTROL_ACCEPTANCE');
  console.log(JSON.stringify(proof, null, 2));
  process.exitCode = proof.ok ? 0 : 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error('MILES_CEO_APPROVAL_CONTROL_ACCEPTANCE_RED');
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}

module.exports = { request, pendingApprovals, main };
