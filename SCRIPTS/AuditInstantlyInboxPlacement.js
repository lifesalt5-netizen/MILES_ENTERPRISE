'use strict';

const fs = require('fs');
const path = require('path');
const instantly = require('../CONNECTORS/INSTANTLY/instantly');

function pct(n, d) { return d ? Number(((n / d) * 100).toFixed(2)) : 0; }
function clean(v) { return String(v || '').trim().toLowerCase(); }
function unwrap(v) { return Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : Array.isArray(v?.data) ? v.data : []; }
function senderStatus({ samples = 0, inboxPct = 0, spamPct = 0, spfPassPct = 0, dkimPassPct = 0, dmarcPassPct = 0 }) {
  if (samples === 0) return 'UNVERIFIED';
  if (spamPct > 0 || inboxPct < 80) return 'WATCH';
  if (spfPassPct < 100 || dkimPassPct < 100 || dmarcPassPct < 100) return 'WATCH';
  return 'ACTIVE';
}

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

async function main() {
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
    const senders = [...bySender.values()].map(s => {
      const inboxPct = pct(s.inbox, s.total);
      const categorizedPct = pct(s.categorized, s.total);
      const spamPct = pct(s.spam, s.total);
      const spfPassPct = pct(s.spfPass, s.total);
      const dkimPassPct = pct(s.dkimPass, s.total);
      const dmarcPassPct = pct(s.dmarcPass, s.total);
      return {
        sender: s.sender,
        samples: s.total,
        inboxPct,
        categorizedPct,
        spamPct,
        spfPassPct,
        dkimPassPct,
        dmarcPassPct,
        testCount: s.tests.size,
        latestAt: s.latestAt,
        status: senderStatus({ samples: s.total, inboxPct, spamPct, spfPassPct, dkimPassPct, dmarcPassPct })
      };
    }).sort((a,b) => a.sender.localeCompare(b.sender));

    const placementVerified = analyticsCount > 0;
    const blocker = placementVerified ? null : (tests.length === 0 ? 'NO_INBOX_PLACEMENT_TESTS_EXIST' : 'INBOX_PLACEMENT_TESTS_HAVE_NO_ANALYTICS');
    const authWatchSenders = senders.filter(s => s.status === 'WATCH' && s.spamPct === 0 && s.inboxPct >= 80 && (s.spfPassPct < 100 || s.dkimPassPct < 100 || s.dmarcPassPct < 100));
    const nextAction = placementVerified
      ? (authWatchSenders.length ? 'REMEDIATE_AUTHENTICATION_BEFORE_ACTIVE_SENDER_USE' : 'USE_LIVE_PLACEMENT_EVIDENCE_TO_GOVERN_SENDERS')
      : (tests.length === 0 ? 'CREATE_OR_RUN_CONTROLLED_INBOX_PLACEMENT_TESTS' : 'WAIT_FOR_OR_RETRIEVE_TEST_ANALYTICS');

    const result = {
      generatedAt: new Date().toISOString(),
      source: 'INSTANTLY_API_V2_INBOX_PLACEMENT',
      readOnly: true,
      testsFound: tests.length,
      analyticsRows: analyticsCount,
      senders,
      placementVerified,
      verificationStatus: placementVerified ? 'VERIFIED' : 'UNVERIFIED',
      truth: placementVerified ? (authWatchSenders.length ? 'LIVE_PLACEMENT_EVIDENCE_PRESENT_WITH_AUTHENTICATION_GAPS' : 'LIVE_PLACEMENT_EVIDENCE_PRESENT') : 'INBOX_PLACEMENT_UNVERIFIED_NO_ANALYTICS',
      blocker,
      authenticationWatchSenders: authWatchSenders.map(s => s.sender),
      nextAction,
      note: 'categorizedPct reflects Instantly has_category evidence and must not be mislabeled as Primary/Inbox. Provider acceptance alone is not inbox placement. ACTIVE requires 100% observed SPF, DKIM, and DMARC pass rates in the current placement evidence.'
    };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(`Tests found: ${tests.length}`);
    console.log(`Analytics rows: ${analyticsCount}`);
    console.log(`Senders with evidence: ${senders.length}`);
    for (const s of senders) console.log(`${s.sender} | inbox=${s.inboxPct}% categorized=${s.categorizedPct}% spam=${s.spamPct}% spf=${s.spfPassPct}% dkim=${s.dkimPassPct}% dmarc=${s.dmarcPassPct}% | ${s.status}`);
    console.log(`Truth: ${result.truth}`);
    if (authWatchSenders.length) console.log(`AUTH WATCH: ${authWatchSenders.map(s => s.sender).join(', ')}`);
    if (blocker) console.log(`BLOCKER: ${blocker}`);
    console.log(`Next action: ${nextAction}`);
    console.log(`Report: ${output}`);
    if (placementVerified) {
      console.log(authWatchSenders.length ? 'RESULT: INSTANTLY_INBOX_PLACEMENT_VERIFIED_WITH_AUTH_WATCH' : 'RESULT: INSTANTLY_INBOX_PLACEMENT_VERIFIED');
    } else {
      console.log('RESULT: INSTANTLY_INBOX_PLACEMENT_UNVERIFIED');
      process.exitCode = 2;
    }
  } catch (error) {
    const msg = String(error?.message || error);
    console.error(msg);
    if (/402|payment required|active paid plan/i.test(msg)) console.log('BLOCKER: INSTANTLY_INBOX_PLACEMENT_PLAN_REQUIRED');
    else if (/401|unauthorized|scope/i.test(msg)) console.log('BLOCKER: INSTANTLY_API_KEY_REQUIRES_INBOX_PLACEMENT_READ_SCOPE');
    console.log('RESULT: INSTANTLY_INBOX_PLACEMENT_AUDIT_RED');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { senderStatus };
