'use strict';

const fs = require('fs');
const path = require('path');
const instantly = require('../CONNECTORS/INSTANTLY/instantly');

function pct(n, d) { return d ? Number(((n / d) * 100).toFixed(2)) : 0; }
function clean(v) { return String(v || '').trim().toLowerCase(); }
function unwrap(v) { return Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : Array.isArray(v?.data) ? v.data : []; }

async function listPaged(endpoint, params = {}) {
  const rows = [];
  let startingAfter = null;
  for (let page = 0; page < 20; page += 1) {
    const p = { limit: 100, ...params };
    if (startingAfter) p.starting_after = startingAfter;
    const response = await instantly.request(endpoint, { method: 'GET', params: p });
    const batch = unwrap(response);
    rows.push(...batch);
    startingAfter = response?.next_starting_after || null;
    if (!startingAfter || !batch.length) break;
  }
  return rows;
}

(async () => {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const outputDir = path.join(root, 'DATA', 'runtime', 'revenue', 'deliverability');
  const output = path.join(outputDir, 'instantly_inbox_placement_latest.json');
  console.log('============================================================');
  console.log('P2GC INSTANTLY INBOX PLACEMENT - LIVE READ ONLY');
  console.log('============================================================');
  try {
    const tests = await listPaged('/inbox-placement-tests');
    const bySender = new Map();
    let analyticsCount = 0;
    for (const test of tests) {
      if (!test?.id) continue;
      const analytics = await listPaged('/inbox-placement-analytics', { test_id: test.id });
      analyticsCount += analytics.length;
      for (const row of analytics) {
        const sender = clean(row.sender_email);
        if (!sender) continue;
        if (!bySender.has(sender)) bySender.set(sender, { sender, total: 0, spam: 0, categorized: 0, inbox: 0, spfPass: 0, dkimPass: 0, dmarcPass: 0, tests: new Set(), latestAt: null });
        const s = bySender.get(sender);
        s.total += 1;
        if (row.is_spam === true) s.spam += 1;
        else if (row.has_category === true) s.categorized += 1;
        else if (row.is_spam === false) s.inbox += 1;
        if (row.spf_pass === true) s.spfPass += 1;
        if (row.dkim_pass === true) s.dkimPass += 1;
        if (row.dmarc_pass === true) s.dmarcPass += 1;
        s.tests.add(test.id);
        if (!s.latestAt || Date.parse(row.timestamp_created || 0) > Date.parse(s.latestAt || 0)) s.latestAt = row.timestamp_created || null;
      }
    }
    const senders = [...bySender.values()].map(s => ({
      sender: s.sender,
      samples: s.total,
      inboxPct: pct(s.inbox, s.total),
      categorizedPct: pct(s.categorized, s.total),
      spamPct: pct(s.spam, s.total),
      spfPassPct: pct(s.spfPass, s.total),
      dkimPassPct: pct(s.dkimPass, s.total),
      dmarcPassPct: pct(s.dmarcPass, s.total),
      testCount: s.tests.size,
      latestAt: s.latestAt,
      status: s.total === 0 ? 'UNVERIFIED' : s.spam > 0 || pct(s.inbox, s.total) < 80 ? 'WATCH' : 'ACTIVE'
    })).sort((a,b) => a.sender.localeCompare(b.sender));

    const result = {
      generatedAt: new Date().toISOString(),
      source: 'INSTANTLY_API_V2_INBOX_PLACEMENT',
      readOnly: true,
      testsFound: tests.length,
      analyticsRows: analyticsCount,
      senders,
      placementVerified: analyticsCount > 0,
      truth: analyticsCount > 0 ? 'LIVE_PLACEMENT_EVIDENCE_PRESENT' : 'INBOX_PLACEMENT_UNVERIFIED_NO_ANALYTICS',
      note: 'categorizedPct reflects Instantly has_category evidence and must not be mislabeled as Primary/Inbox. Provider acceptance alone is not inbox placement.'
    };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(`Tests found: ${tests.length}`);
    console.log(`Analytics rows: ${analyticsCount}`);
    console.log(`Senders with evidence: ${senders.length}`);
    for (const s of senders) console.log(`${s.sender} | inbox=${s.inboxPct}% categorized=${s.categorizedPct}% spam=${s.spamPct}% | ${s.status}`);
    console.log(`Truth: ${result.truth}`);
    console.log(`Report: ${output}`);
    console.log('RESULT: INSTANTLY_INBOX_PLACEMENT_AUDIT_GREEN');
  } catch (error) {
    const msg = String(error?.message || error);
    console.error(msg);
    if (/402|payment required|active paid plan/i.test(msg)) console.log('BLOCKER: INSTANTLY_INBOX_PLACEMENT_PLAN_REQUIRED');
    else if (/401|unauthorized|scope/i.test(msg)) console.log('BLOCKER: INSTANTLY_API_KEY_REQUIRES_INBOX_PLACEMENT_READ_SCOPE');
    console.log('RESULT: INSTANTLY_INBOX_PLACEMENT_AUDIT_RED');
    process.exitCode = 1;
  }
})();
