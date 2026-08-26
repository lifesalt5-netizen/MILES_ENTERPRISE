'use strict';

const fs = require('fs');
const path = require('path');
const instantly = require('../CONNECTORS/INSTANTLY/instantly');

function unwrap(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.items)) return v.items;
  if (Array.isArray(v?.data)) return v.data;
  return [];
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

(async () => {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const outputDir = path.join(root, 'DATA', 'runtime', 'revenue', 'deliverability');
  const output = path.join(outputDir, 'instantly_inbox_placement_diagnostic_latest.json');
  console.log('============================================================');
  console.log('P2GC INSTANTLY INBOX PLACEMENT - TEST DIAGNOSTIC');
  console.log('============================================================');
  try {
    const tests = await listPaged('/inbox-placement-tests');
    if (!tests.length) {
      console.log('BLOCKER: NO_INBOX_PLACEMENT_TESTS_EXIST');
      process.exitCode = 2;
      return;
    }

    const test = [...tests].sort((a, b) => Date.parse(b.timestamp_created || 0) - Date.parse(a.timestamp_created || 0))[0];
    const readback = await instantly.request(`/inbox-placement-tests/${encodeURIComponent(test.id)}`, { method: 'GET', params: { with_metadata: true } });
    const analytics = await listPaged('/inbox-placement-analytics', { test_id: test.id });
    let reports = [];
    try {
      reports = await listPaged('/inbox-placement-reports', { test_id: test.id });
    } catch (e) {
      reports = [{ error: String(e?.message || e) }];
    }

    const createdAt = readback.timestamp_created || null;
    const ageMinutes = createdAt ? Math.max(0, Math.round((Date.now() - Date.parse(createdAt)) / 60000)) : null;
    const result = {
      generatedAt: new Date().toISOString(),
      testId: readback.id || test.id,
      name: readback.name || test.name || null,
      status: readback.status ?? null,
      notSendingStatus: readback.not_sending_status || null,
      timestampCreated: createdAt,
      timestampNextRun: readback.timestamp_next_run || null,
      ageMinutes,
      senderCount: Array.isArray(readback.emails) ? readback.emails.length : 0,
      recipientCount: Array.isArray(readback.recipients) ? readback.recipients.length : 0,
      providerLabels: Array.isArray(readback.recipients_labels) ? readback.recipients_labels : [],
      analyticsRows: analytics.length,
      reportRows: reports.filter(r => !r.error).length,
      reportErrors: reports.filter(r => r.error).map(r => r.error),
      truth: analytics.length > 0 ? 'ANALYTICS_AVAILABLE' : (readback.not_sending_status ? 'PROVIDER_NOT_SENDING_BLOCKER' : ageMinutes !== null && ageMinutes >= 15 ? 'ANALYTICS_DELAYED_OR_STALLED' : 'TEST_CREATED_AWAITING_ANALYTICS')
    };

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));

    console.log(`Test ID: ${result.testId}`);
    console.log(`Status: ${result.status}`);
    console.log(`Not-sending status: ${result.notSendingStatus || 'NONE'}`);
    console.log(`Created: ${result.timestampCreated}`);
    console.log(`Next run: ${result.timestampNextRun || 'NONE'}`);
    console.log(`Age minutes: ${result.ageMinutes}`);
    console.log(`Senders: ${result.senderCount}`);
    console.log(`Recipients: ${result.recipientCount}`);
    console.log(`Analytics rows: ${result.analyticsRows}`);
    console.log(`Report rows: ${result.reportRows}`);
    if (result.reportErrors.length) console.log(`Report read warning: ${result.reportErrors.join(' | ')}`);
    console.log(`Truth: ${result.truth}`);
    console.log(`Report: ${output}`);

    if (result.truth === 'ANALYTICS_AVAILABLE') console.log('RESULT: INBOX_PLACEMENT_DIAGNOSTIC_GREEN');
    else if (result.truth === 'TEST_CREATED_AWAITING_ANALYTICS') console.log('RESULT: INBOX_PLACEMENT_DIAGNOSTIC_WAIT');
    else {
      console.log('RESULT: INBOX_PLACEMENT_DIAGNOSTIC_WATCH');
      process.exitCode = 3;
    }
  } catch (error) {
    console.error(String(error?.stack || error?.message || error));
    console.log('RESULT: INBOX_PLACEMENT_DIAGNOSTIC_RED');
    process.exitCode = 1;
  }
})();
