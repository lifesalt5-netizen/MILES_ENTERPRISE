'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Service = require('../SERVICES/demo/SamQualifiedProspectFallbackService');

function makeRoot(rows, reportOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-prospect-fallback-'));
  const refresh = path.join(root, 'DATA', 'orion_refresh');
  fs.mkdirSync(refresh, { recursive: true });
  const dbPath = path.join(refresh, 'sam-qualified.db');
  fs.writeFileSync(dbPath, 'fixture', 'utf8');
  const report = {
    ok: true,
    generatedAt: '2026-09-01T12:00:00.000Z',
    source: { fileName: 'SAM_PUBLIC_UTF-8_MONTHLY_V2_20260830.ZIP', date: '20260830' },
    output: { database: dbPath, sqliteIntegrity: 'ok', storedQualifiedCompanies: rows.length },
    safety: { stagingOnly: true, productionDatabaseModified: false },
    ...reportOverrides
  };
  fs.writeFileSync(path.join(refresh, 'latest_sam_qualified_universe_build.json'), JSON.stringify(report, null, 2));
  return { root, dbPath };
}

function fakeDatabase(rows) {
  return class FakeDatabase {
    constructor() {}
    prepare() {
      return { all: () => rows.map(row => ({ ...row })) };
    }
    close() {}
  };
}

const delune = {
  uei: 'ABC123456789',
  cage: '1A2B3',
  legal_name: 'DELUNE CORPORATION',
  dba: '',
  registration_expiration_date: '2027-08-30',
  last_update_date: '2026-08-30',
  activation_date: '2025-01-01',
  website: 'https://example.test',
  primary_naics: '541512',
  naics_codes: '541512~541519',
  sba_business_type_codes: '',
  business_type_codes: '2X',
  city: 'WASHINGTON',
  state: 'DC',
  zip: '20001',
  country: 'USA',
  source_file: 'SAM_PUBLIC_UTF-8_MONTHLY_V2_20260830.ZIP',
  source_date: '20260830',
  loaded_at: '2026-09-01T12:00:00.000Z'
};

{
  const { root } = makeRoot([delune]);
  const service = new Service({ rootDir: root, Database: fakeDatabase([delune]) });
  const result = service.build('DeLune Corporation');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'DEMO_READY_WITH_SAM_IDENTITY_AND_COVERAGE_GAPS');
  assert.equal(result.profile.companyName, 'DELUNE CORPORATION');
  assert.equal(result.profile.uei, 'ABC123456789');
  assert.equal(result.profile.cage, '1A2B3');
  assert.equal(result.profile.samStatus, 'ACTIVE');
  assert.deepStrictEqual(result.profile.naicsCodes, ['541512', '541519']);
  assert.equal(result.currentState.activeContracts, null);
  assert.equal(result.currentState.federalSales, null);
  assert.equal(result.revenue.current.federal, null);
  assert.equal(result.vehicles.status, 'VEHICLE_STATUS_UNCONFIRMED');
  assert.deepStrictEqual(result.vehicles.current, []);
  assert.equal(result.evidence.identity.authority, 'SAM_PUBLIC_BULK_QUALIFIED_UNIVERSE');
  assert.equal(result.safety.readOnly, true);
  assert.equal(result.safety.contactsInvented, false);
  service.close();
}

{
  const duplicate = { ...delune, uei: 'ZZZ987654321' };
  const rows = [delune, duplicate];
  const { root } = makeRoot(rows);
  const service = new Service({ rootDir: root, Database: fakeDatabase(rows) });
  const result = service.build('DeLune Corporation');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'SAM_IDENTITY_AMBIGUOUS');
  assert.equal(result.candidateCount, 2);
  service.close();
}

{
  const { root } = makeRoot([delune], { ok: false });
  const service = new Service({ rootDir: root, Database: fakeDatabase([delune]) });
  const result = service.build('DeLune Corporation');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'SAM_QUALIFIED_UNIVERSE_NOT_USABLE');
}

console.log('SAM_QUALIFIED_PROSPECT_FALLBACK_TEST: GREEN');
