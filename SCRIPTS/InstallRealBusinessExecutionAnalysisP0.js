'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const target = path.join(ROOT, 'SERVICES', 'WorkforceExecutionService.js');

if (!fs.existsSync(target)) throw new Error('Missing ' + target);

let text = fs.readFileSync(target, 'utf8');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const backup = target + '.BEFORE_REAL_BUSINESS_EXECUTION_' + stamp;
fs.copyFileSync(target, backup);

let changes = 0;

if (!text.includes('RevenueMissionSourceService')) {
  const anchor = 'const executiveState = require("./ExecutiveStateService");';
  if (!text.includes(anchor)) throw new Error('Import anchor not found.');
  text = text.replace(anchor, anchor + '\nconst RevenueMissionSourceService = require("./RevenueMissionSourceService");');
  changes++;
}

if (!text.includes('function buildBusinessExecutionRecommendation(')) {
  const anchor = 'function defaultRecommendation(task, employee) {';
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error('defaultRecommendation anchor not found.');

  const helper = String.raw`
function buildBusinessExecutionRecommendation(task = {}) {
  const payload = task.payload || {};
  const source = new RevenueMissionSourceService({ rootDir: ROOT });
  const snapshot = source.readCandidates();
  const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];

  const terminal = new Set(['COMPLETED', 'EXECUTED', 'CANCELLED', 'REJECTED', 'CLOSED']);
  const active = candidates.filter(item => !terminal.has(String(item.status || '').toUpperCase()));

  function score(item) {
    const expectedRevenue = Number(item.expectedRevenue || 0);
    const urgency = Number(item.urgency || 0);
    const customerImpact = Number(item.customerImpact || 0);
    const strategicValue = Number(item.strategicValue || 0);
    const confidence = Number(item.executionConfidence || 0);
    const risk = Number(item.risk || 0);
    return (
      expectedRevenue * 0.28 +
      urgency * 0.24 +
      customerImpact * 0.14 +
      strategicValue * 0.20 +
      confidence * 0.14 -
      risk * 0.10
    );
  }

  const ranked = active
    .map(item => ({ ...item, executiveScore: Number(score(item).toFixed(2)) }))
    .sort((a, b) => b.executiveScore - a.executiveScore)
    .slice(0, 3);

  const sourceSummary = Array.isArray(snapshot.sourceSummary) ? snapshot.sourceSummary : [];

  if (!ranked.length) {
    return {
      summary: 'MILES reviewed the configured revenue mission sources but found no active actionable revenue records.',
      recommendation: 'Do not invent a priority. Refresh or repair the revenue source feeds before making a revenue decision.',
      nextActions: [
        'Verify the revenue work queue and CRM follow-up source files contain current active records.',
        'Refresh live campaign and proposal/client-delivery visibility where applicable.',
        'Rerun the executive revenue review after source coverage is restored.'
      ],
      topActions: [],
      evidence: { sourceSummary, activeCandidateCount: 0, totalCandidateCount: candidates.length },
      needsHumanInput: false,
      ceoApprovalRequired: false
    };
  }

  const topActions = ranked.map((item, index) => ({
    rank: index + 1,
    title: item.title || item.objective || item.action || 'Revenue action',
    objective: item.objective || null,
    stage: item.revenueStage || null,
    provider: item.provider || null,
    action: item.action || null,
    status: item.status || null,
    executiveScore: item.executiveScore,
    dueDate: item.dueDate || null,
    source: item.source || item.metadata?.source || null,
    sourceFile: item.sourceQueue || item.metadata?.sourceFile || null,
    requiresCEO: Boolean(item.requiresCEO || item.requiresKevin)
  }));

  return {
    summary: 'MILES reviewed current configured revenue sources and ranked the top ' + topActions.length + ' active actions for the CEO objective.',
    recommendation: topActions.map(x => x.rank + '. ' + x.title).join(' | '),
    nextActions: topActions.map(x => x.title),
    topActions,
    evidence: {
      sourceSummary,
      activeCandidateCount: active.length,
      totalCandidateCount: candidates.length,
      rankingMethod: 'expectedRevenue 28%, urgency 24%, strategicValue 20%, customerImpact 14%, executionConfidence 14%, less risk 10%'
    },
    needsHumanInput: false,
    ceoApprovalRequired: false
  };
}

`;
  text = text.slice(0, idx) + helper + text.slice(idx);
  changes++;
}

const oldLine = '    const output = providerResult\n      ? {';
if (!text.includes('const isBusinessExecution =')) {
  const idx = text.indexOf(oldLine);
  if (idx < 0) throw new Error('Output selection anchor not found.');
  const prefix = '    const isBusinessExecution =\n      String(payload.capability || payload.action || "").toUpperCase() === "BUSINESS_EXECUTION";\n\n';
  text = text.slice(0, idx) + prefix + text.slice(idx);
  changes++;
}

const fallback = '      : defaultRecommendation(task, employee);';
if (text.includes(fallback) && !text.includes(': (isBusinessExecution\n          ? buildBusinessExecutionRecommendation(task)')) {
  text = text.replace(
    fallback,
    '      : (isBusinessExecution\n          ? buildBusinessExecutionRecommendation(task)\n          : defaultRecommendation(task, employee));'
  );
  changes++;
}

if (!changes) {
  console.log('No changes required; real BUSINESS_EXECUTION analysis appears installed already.');
  process.exit(0);
}

fs.writeFileSync(target, text, 'utf8');

console.log('=== REAL BUSINESS EXECUTION ANALYSIS P0 ===');
console.log('patched:', target);
console.log('backup :', backup);
console.log('changes:', changes);
console.log('next   : node --check .\\SERVICES\\WorkforceExecutionService.js');
