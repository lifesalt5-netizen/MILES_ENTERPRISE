const fs = require('fs');
const path = require('path');

const EXPECTED_CODES = [
  'AL','AK','AZ','AR','CA','TX','FL','VA','CO','CT','DE','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','UT','VT','WA','WV','WI','WY','DC'
];

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, service: 'STATE_PROCUREMENT_OFFICIAL_SOURCE_REGISTRY_VALIDATION', message, ...details }, null, 2));
  process.exit(1);
}

function main() {
  const configDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'CONFIG'));
  if (!fs.existsSync(configDir)) fail('CONFIG directory not found', { configDir });

  const files = fs.readdirSync(configDir)
    .filter(name => /^StateProcurementOfficialSources\.Batch\d+\.json$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (files.length !== 13) fail('Expected 13 batch files', { batchFileCount: files.length, files });

  const jurisdictions = [];
  const errors = [];

  for (const file of files) {
    const fullPath = path.join(configDir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (err) {
      fail('Invalid JSON', { file, error: err.message });
    }

    if (!Array.isArray(parsed.jurisdictions)) {
      errors.push({ file, error: 'jurisdictions is not an array' });
      continue;
    }

    for (const j of parsed.jurisdictions) {
      const code = String(j.code || '').trim().toUpperCase();
      if (!code) errors.push({ file, error: 'missing jurisdiction code', jurisdiction: j.name || null });
      if (!j.name) errors.push({ file, code, error: 'missing jurisdiction name' });
      if (!j.status) errors.push({ file, code, error: 'missing status' });
      if (!j.vendorRegistryStatus) errors.push({ file, code, error: 'missing vendorRegistryStatus' });
      if (!j.awardSourceStatus) errors.push({ file, code, error: 'missing awardSourceStatus' });

      for (const [kind, sources] of [['vendorSources', j.vendorSources || []], ['awardSources', j.awardSources || []]]) {
        if (!Array.isArray(sources)) {
          errors.push({ file, code, error: `${kind} is not an array` });
          continue;
        }
        for (const source of sources) {
          if (!source.name) errors.push({ file, code, kind, error: 'source missing name' });
          if (!source.authority) errors.push({ file, code, kind, error: 'source missing authority' });
          if (!source.url) errors.push({ file, code, kind, error: 'source missing url' });
          if (source.url && !/^https:\/\//i.test(source.url)) errors.push({ file, code, kind, url: source.url, error: 'source url must use https' });
          if (!source.purpose) errors.push({ file, code, kind, error: 'source missing purpose' });
          if (!source.ingestionMode) errors.push({ file, code, kind, error: 'source missing ingestionMode' });
        }
      }

      jurisdictions.push({ file, code, name: j.name, status: j.status, vendorRegistryStatus: j.vendorRegistryStatus, awardSourceStatus: j.awardSourceStatus });
    }
  }

  const byCode = new Map();
  for (const row of jurisdictions) {
    const list = byCode.get(row.code) || [];
    list.push(row);
    byCode.set(row.code, list);
  }

  const duplicateCodes = [...byCode.entries()].filter(([, rows]) => rows.length > 1).map(([code, rows]) => ({ code, occurrences: rows.length, files: rows.map(r => r.file) }));
  const actualCodes = [...byCode.keys()].sort();
  const missingCodes = EXPECTED_CODES.filter(code => !byCode.has(code));
  const unexpectedCodes = actualCodes.filter(code => !EXPECTED_CODES.includes(code));
  const partial = jurisdictions.filter(j => /PARTIAL|REQUIRES_VALIDATION|DISCOVERY_REQUIRED|UNCONFIRMED/i.test(`${j.status} ${j.vendorRegistryStatus} ${j.awardSourceStatus}`));

  if (jurisdictions.length !== 51) errors.push({ error: 'Expected 51 jurisdiction entries', actual: jurisdictions.length });
  if (duplicateCodes.length) errors.push({ error: 'Duplicate jurisdiction codes', duplicateCodes });
  if (missingCodes.length) errors.push({ error: 'Missing expected jurisdiction codes', missingCodes });
  if (unexpectedCodes.length) errors.push({ error: 'Unexpected jurisdiction codes', unexpectedCodes });

  const summary = {
    ok: errors.length === 0,
    service: 'STATE_PROCUREMENT_OFFICIAL_SOURCE_REGISTRY_VALIDATION',
    batchFileCount: files.length,
    jurisdictionEntryCount: jurisdictions.length,
    uniqueJurisdictionCount: byCode.size,
    expectedJurisdictionCount: EXPECTED_CODES.length,
    duplicateCodes,
    missingCodes,
    unexpectedCodes,
    partialJurisdictionCount: partial.length,
    partialJurisdictions: partial.map(j => ({ code: j.code, status: j.status, vendorRegistryStatus: j.vendorRegistryStatus, awardSourceStatus: j.awardSourceStatus })),
    errors
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main();
