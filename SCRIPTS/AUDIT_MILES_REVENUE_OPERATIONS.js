'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = root;
const dotenv = require(path.join(root, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true });

const instantly = require(path.join(root, 'CONNECTORS', 'INSTANTLY', 'connector.js'));
const CalendlyRevenuePipelineService = require(path.join(root, 'SERVICES', 'CalendlyRevenuePipelineService.js'));
const outDir = path.join(root, 'DATA', 'operational_acceptance');
const outJson = path.join(outDir, 'latest_revenue_operations_acceptance.json');
const outMd = path.join(outDir, 'latest_revenue_operations_acceptance.md');
const calendlyAcceptancePath = path.join(outDir, 'latest_calendly_pipeline_acceptance.json');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function ageHours(p) { try { return (Date.now() - fs.statSync(p).mtimeMs) / 3600000; } catch { return null; } }
function statusByAge(hours, green = 24, yellow = 72) {
  if (hours === null) return 'RED';
  if (hours <= green) return 'GREEN';
  if (hours <= yellow) return 'YELLOW';
  return 'RED';
}
function deepArray(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return [];
  for (const key of ['items','data','campaigns','accounts','leads','emails','results']) {
    const child = v[key];
    if (Array.isArray(child)) return child;
    if (child && typeof child === 'object') {
      const nested = deepArray(child);
      if (nested.length) return nested;
    }
  }
  return [];
}
function providerOk(v) {
  if (!v || v.ok === false) return false;
  const s = JSON.stringify(v).toLowerCase();
  return !(s.includes('missing_credentials') || s.includes('http_error') || s.includes('request_error') || s.includes('unauthorized'));
}
function safeSummary(v) {
  if (!v) return null;
  const arr = deepArray(v);
  return { ok: providerOk(v), returned: arr.length };
}
function findNeedle(base, needle, maxBytes = 2 * 1024 * 1024) {
  const hits = [];
  if (!fs.existsSync(base)) return hits;
  const allowed = new Set(['.json','.csv','.md','.txt','.js','.ps1']);
  const stack = [base];
  while (stack.length && hits.length < 50) {
    const cur = stack.pop();
    let st;
    try { st = fs.statSync(cur); } catch { continue; }
    if (st.isDirectory()) {
      const n = path.basename(cur).toLowerCase();
      if (['node_modules','.git','_backups','_legacy_builds'].includes(n)) continue;
      let kids = [];
      try { kids = fs.readdirSync(cur); } catch { continue; }
      for (const k of kids) stack.push(path.join(cur, k));
      continue;
    }
    if (cur.toUpperCase().includes(needle)) { hits.push(path.relative(root, cur)); continue; }
    if (st.size > maxBytes || !allowed.has(path.extname(cur).toLowerCase())) continue;
    try {
      const text = fs.readFileSync(cur, 'utf8');
      if (text.toUpperCase().includes(needle)) hits.push(path.relative(root, cur));
    } catch {}
  }
  return hits;
}
function recentEvidence(base, regex) {
  const rows = [];
  if (!fs.existsSync(base)) return rows;
  const stack = [base];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try { st = fs.statSync(cur); } catch { continue; }
    if (st.isDirectory()) {
      const n = path.basename(cur).toLowerCase();
      if (['node_modules','.git','_backups','_legacy_builds'].includes(n)) continue;
      let kids = [];
      try { kids = fs.readdirSync(cur); } catch { continue; }
      for (const k of kids) stack.push(path.join(cur, k));
    } else if (regex.test(path.basename(cur))) {
      rows.push({ path: path.relative(root, cur), modifiedAt: st.mtime.toISOString(), ageHours: (Date.now() - st.mtimeMs) / 3600000 });
    }
  }
  return rows.sort((a,b) => a.ageHours - b.ageHours).slice(0, 10);
}
function freshCalendlyAcceptance(report, maxAgeHours = 24) {
  if (!report || !report.generatedAt || !report.checks || !report.inventory) return false;
  const generatedMs = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedMs)) return false;
  const age = (Date.now() - generatedMs) / 3600000;
  if (age < 0 || age > maxAgeHours) return false;
  return report.checks.calendly_authentication === 'GREEN' &&
    report.checks.scheduled_event_visibility === 'GREEN' &&
    report.checks.p2gc_booking_visibility === 'GREEN' &&
    report.checks.invitee_visibility === 'GREEN' &&
    Number(report.inventory.p2gcEvents || 0) > 0 &&
    Number(report.inventory.invitees || 0) > 0;
}

(async () => {
  const startedAt = new Date().toISOString();
  const calls = {};
  for (const [name, action, payload] of [
    ['campaigns','listCampaigns',{ limit: 100 }],
    ['accounts','listAccounts',{ limit: 100 }],
    ['leads','listLeads',{ limit: 100 }],
    ['emails','listEmails',{ limit: 100 }]
  ]) {
    try { calls[name] = await instantly.execute({ action, payload }, { audit: true, readOnly: true }); }
    catch (error) { calls[name] = { ok: false, error: error.message }; }
  }

  let calendlySync = null;
  let calendlyRefreshError = null;
  let calendlyEvidenceSource = 'LIVE_REFRESH';
  try {
    const calendlyPipeline = new CalendlyRevenuePipelineService({ rootDir: root });
    calendlySync = await calendlyPipeline.runOnce();
  } catch (error) {
    calendlyRefreshError = error.message;
    calendlySync = {
      ok: false,
      status: 'CALENDLY_REVENUE_PIPELINE_REFRESH_FAILED',
      error: error.message,
      generatedAt: new Date().toISOString()
    };
  }

  if (!calendlySync || calendlySync.ok !== true) {
    const fallback = readJson(calendlyAcceptancePath);
    if (freshCalendlyAcceptance(fallback, 24)) {
      calendlyEvidenceSource = 'LAST_KNOWN_GOOD_ACCEPTANCE';
      calendlySync = {
        ok: true,
        status: 'CALENDLY_ACCEPTANCE_LAST_KNOWN_GOOD',
        generatedAt: fallback.generatedAt,
        account: fallback.account || null,
        metrics: fallback.inventory || null,
        fallbackEvidencePath: path.relative(root, calendlyAcceptancePath),
        liveRefreshError: calendlyRefreshError || null,
        externalWritesPerformed: false
      };
    }
  }

  const marketingPath = path.join(root, 'DATA', 'marketing_coo', 'latest_marketing_operation.json');
  const briefPath = path.join(root, 'DATA', 'executive', 'latest_executive_brief.json');
  const marketingAge = ageHours(marketingPath);
  const briefAge = ageHours(briefPath);
  const currentHelpHits = findNeedle(path.join(root, 'DATA'), 'CURRENTLY_LOOKING_FOR_HELP');
  const meetingEvidence = recentEvidence(path.join(root, 'DATA'), /(meeting|calendar|appointment|calendly)/i);
  const replyEvidence = recentEvidence(path.join(root, 'DATA'), /(reply|unibox|email)/i);

  const summaries = Object.fromEntries(Object.entries(calls).map(([k,v]) => [k, safeSummary(v)]));
  const instantlyGreen = Object.values(summaries).every(v => v && v.ok);
  const meetingPipelineGreen = Boolean(
    calendlySync &&
    calendlySync.ok === true &&
    meetingEvidence.length &&
    meetingEvidence[0].ageHours <= 24
  );
  const checks = {
    instantly_read_connectivity: instantlyGreen ? 'GREEN' : 'RED',
    campaign_inventory: summaries.campaigns?.ok && summaries.campaigns.returned > 0 ? 'GREEN' : 'RED',
    sender_account_inventory: summaries.accounts?.ok && summaries.accounts.returned > 0 ? 'GREEN' : 'RED',
    lead_visibility: summaries.leads?.ok ? (summaries.leads.returned > 0 ? 'GREEN' : 'YELLOW') : 'RED',
    reply_visibility: summaries.emails?.ok ? 'GREEN' : 'RED',
    currently_looking_for_help: currentHelpHits.length ? 'GREEN' : 'RED',
    marketing_operation_freshness: statusByAge(marketingAge),
    morning_brief_freshness: statusByAge(briefAge, 36, 72),
    calendly_refresh_status: calendlyEvidenceSource === 'LIVE_REFRESH' && calendlySync?.ok === true ? 'GREEN' : (calendlySync?.ok === true ? 'YELLOW' : 'RED'),
    meeting_pipeline_evidence: meetingPipelineGreen ? 'GREEN' : 'RED'
  };

  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    root,
    mode: 'READ_ONLY_EXTERNAL_AUDIT',
    externalWritesPerformed: false,
    instantlyWritesEnabled: String(process.env.INSTANTLY_WRITE_ENABLED || 'false').toLowerCase() === 'true',
    controlledWritesEnabled: String(process.env.MILES_CONTROLLED_WRITE_ENABLED || 'false').toLowerCase() === 'true',
    checks,
    instantly: summaries,
    currentlyLookingForHelp: { found: currentHelpHits.length > 0, hits: currentHelpHits },
    evidence: {
      marketingOperation: { path: path.relative(root, marketingPath), exists: fs.existsSync(marketingPath), ageHours: marketingAge, data: readJson(marketingPath) },
      executiveBrief: { path: path.relative(root, briefPath), exists: fs.existsSync(briefPath), ageHours: briefAge, data: readJson(briefPath) },
      calendlyPipelineSync: {
        ok: calendlySync?.ok === true,
        status: calendlySync?.status || null,
        generatedAt: calendlySync?.generatedAt || null,
        account: calendlySync?.account || null,
        metrics: calendlySync?.metrics || null,
        evidenceSource: calendlyEvidenceSource,
        liveRefreshError: calendlyRefreshError || calendlySync?.liveRefreshError || null,
        fallbackEvidencePath: calendlySync?.fallbackEvidencePath || null,
        error: calendlySync?.error || null,
        externalWritesPerformed: false
      },
      meeting: meetingEvidence,
      reply: replyEvidence
    },
    nextPriority: !instantlyGreen ? 'FIX_INSTANTLY_READ_CONNECTIVITY' :
      !currentHelpHits.length ? 'BUILD_CURRENTLY_LOOKING_FOR_HELP' :
      checks.marketing_operation_freshness !== 'GREEN' ? 'RESTORE_MARKETING_OPERATION_LOOP' :
      checks.meeting_pipeline_evidence !== 'GREEN' ? 'RESTORE_MEETING_PIPELINE' :
      checks.calendly_refresh_status === 'YELLOW' ? 'RETRY_CALENDLY_LIVE_REFRESH_WITHOUT_INVALIDATING_MEETING_EVIDENCE' :
      'PROVE_END_TO_END_OUTBOUND_TO_MEETING'
  };

  ensureDir(outDir);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# MILES Revenue Operations Acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `External writes performed: ${report.externalWritesPerformed}`,
    '',
    '## Status',
    ...Object.entries(checks).map(([k,v]) => `- ${k}: ${v}`),
    '',
    '## Instantly read-only inventory',
    ...Object.entries(summaries).map(([k,v]) => `- ${k}: ok=${Boolean(v?.ok)} returned=${v?.returned ?? 0}`),
    '',
    '## Calendly revenue pipeline refresh',
    `- ok: ${Boolean(calendlySync?.ok)}`,
    `- status: ${calendlySync?.status || 'UNKNOWN'}`,
    `- source: ${calendlyEvidenceSource}`,
    `- generated: ${calendlySync?.generatedAt || 'UNKNOWN'}`,
    `- live refresh error: ${calendlyRefreshError || 'NONE'}`,
    '',
    `## CURRENTLY_LOOKING_FOR_HELP`,
    `- found: ${currentHelpHits.length > 0}`,
    `- evidence files: ${currentHelpHits.length}`,
    '',
    `## Next priority`,
    `- ${report.nextPriority}`,
    ''
  ];
  fs.writeFileSync(outMd, lines.join('\n'), 'utf8');

  console.log('============================================================');
  console.log('MILES REVENUE OPERATIONS ACCEPTANCE - READ ONLY');
  console.log('============================================================');
  for (const [k,v] of Object.entries(checks)) console.log(`${k}: ${v}`);
  console.log('');
  for (const [k,v] of Object.entries(summaries)) console.log(`Instantly ${k}: ok=${Boolean(v?.ok)} returned=${v?.returned ?? 0}`);
  console.log(`Calendly pipeline refresh: ok=${Boolean(calendlySync?.ok)} status=${calendlySync?.status || 'UNKNOWN'} source=${calendlyEvidenceSource}`);
  if (calendlyRefreshError) console.log(`Calendly live refresh error: ${calendlyRefreshError}`);
  console.log(`CURRENTLY_LOOKING_FOR_HELP evidence files: ${currentHelpHits.length}`);
  console.log(`Next priority: ${report.nextPriority}`);
  console.log(`Report: ${outJson}`);
  console.log(`Summary: ${outMd}`);
  process.exitCode = instantlyGreen ? 0 : 2;
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

module.exports = { freshCalendlyAcceptance };
