'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Service = require('../SERVICES/orion/SamEntityPublicBulkFilenameProbeFallbackService');

(async () => {
  const dates = Service.monthlyCandidateDates(new Date('2026-09-02T20:00:00Z'), 4, 10);
  assert(dates.length > 0);
  assert(dates.every(date => date.getTime() <= Date.parse('2026-09-02T20:00:00Z')));
  assert.strictEqual(Service.buildCandidate(new Date('2026-08-02T00:00:00Z')).fileName, 'SAM_PUBLIC_UTF-8_MONTHLY_V2_20260802.ZIP');
  assert(Service.buildCandidate(new Date('2026-08-02T00:00:00Z')).downloadUrl.startsWith('https://sam.gov/api/prod/fileextractservices/v1/api/download/Entity%20Registration/Public%20V2/'));

  const seen = [];
  const service = new Service({
    now: '2026-09-02T20:00:00Z',
    monthsBack: 4,
    maxDay: 10,
    head: async url => {
      seen.push(url);
      const found = /SAM_PUBLIC_UTF-8_MONTHLY_V2_20260802\.ZIP/i.test(decodeURIComponent(url));
      return found
        ? { ok: true, statusCode: 303, contentType: 'application/octet-stream', contentLength: null, location: 'https://official-example-signed-location.invalid' }
        : { ok: false, statusCode: 404, errorHint: 'HTTP_404' };
    }
  });
  const result = await service.run();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.discoveryMethod, 'OFFICIAL_SAM_MONTHLY_FILENAME_HEAD_PROBE');
  assert.strictEqual(result.latestFile.displayKey, 'SAM_PUBLIC_UTF-8_MONTHLY_V2_20260802.ZIP');
  assert.strictEqual(result.downloadHead.statusCode, 303);
  assert(result.attempts > 0);
  assert.strictEqual(result.attempts, seen.length);
  assert(seen.every(url => new URL(url).hostname === 'sam.gov'));

  const none = await new Service({
    now: '2026-09-02T20:00:00Z',
    monthsBack: 2,
    maxDay: 7,
    head: async () => ({ ok: false, statusCode: 404, errorHint: 'HTTP_404' })
  }).run();
  assert.strictEqual(none.ok, false);
  assert.strictEqual(none.ready, false);
  assert.strictEqual(none.latestFile, null);
  assert.strictEqual(none.blocker, 'NO_REACHABLE_UTF8_MONTHLY_PUBLIC_V2_EXTRACT_FOUND_IN_BOUNDED_DATE_WINDOW');

  const auditSource = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AuditFederalSourceReadiness.js'), 'utf8');
  assert(auditSource.includes("process.exitCode = result?.ok === true ? 0 : 2"));
  assert(auditSource.includes("blocker => blocker !== 'SAM_ENTITY_PUBLIC_BULK_EXTRACT_NOT_DISCOVERED_OR_NOT_REACHABLE'"));
  assert(auditSource.includes('officialMonthlyFilenameHeadProbeUsed: true'));

  console.log('SAM_ENTITY_PUBLIC_BULK_FILENAME_PROBE_FALLBACK_TEST=PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
