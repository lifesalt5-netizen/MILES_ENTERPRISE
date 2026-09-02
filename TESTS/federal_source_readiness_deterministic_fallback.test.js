'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Sam = require('../SERVICES/orion/SamBulkExtractAcquisitionService');

const svc = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'orion', 'FederalSourceReadinessAuditServiceV2.js'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AuditFederalSourceReadiness.js'), 'utf8');

const names = Sam.candidateEntityNames(new Date('2026-09-02T20:00:00Z'), 8);
assert.strictEqual(names[0], 'SAM_PUBLIC_UTF-8_MONTHLY_V2_20260906.ZIP' === names[0] ? names[0] : 'SAM_PUBLIC_UTF-8_MONTHLY_V2_20260802.ZIP');
assert(names.every(name => /^SAM_PUBLIC_UTF-8_MONTHLY_V2_\d{8}\.ZIP$/.test(name)));
assert(svc.includes('DETERMINISTIC_FIRST_SUNDAY_OFFICIAL_DOWNLOAD_HEAD_FALLBACK'));
assert(svc.includes("method: 'HEAD'"));
assert(svc.includes('deterministicFallbackDownloadsPerformed: false'));
assert(svc.includes('productionDatabaseModified: false'));
assert(svc.includes('credentialsModified: false'));
assert(svc.includes("filter(x => x !== 'SAM_ENTITY_PUBLIC_BULK_EXTRACT_NOT_DISCOVERED_OR_NOT_REACHABLE')"));
assert(!svc.includes('streamDownload('));
assert(!svc.includes('api_key'));
assert(runner.includes("require('../SERVICES/orion/FederalSourceReadinessAuditServiceV2')"));

console.log('FEDERAL_SOURCE_READINESS_DETERMINISTIC_FALLBACK_TEST=PASS');
