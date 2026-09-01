'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B12HistoricalUniverseDiscoveryService = require('../SERVICES/revenue/B12HistoricalUniverseDiscoveryService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-b12-discovery-'));
try {
  const outbound = path.join(root, 'DATA', 'OUTBOUND');
  const marketing = path.join(root, 'DATA', 'marketing_coo');
  const history = path.join(root, 'historical');
  fs.mkdirSync(outbound, { recursive: true });
  fs.mkdirSync(marketing, { recursive: true });
  fs.mkdirSync(history, { recursive: true });

  const master = path.join(outbound, 'MASTER_DEDUPED_ALL_SEGMENTS.csv');
  fs.writeFileSync(master, 'Company,Email,UEI\nCurrent Co,current@example.com,ABC123\n', 'utf8');

  const b12 = path.join(history, 'B12_campaign_contacts_2025-10.csv');
  fs.writeFileSync(b12, 'Company,First Name,Last Name,Email\nOld Co,Jane,Doe,jane@old.example\n', 'utf8');

  const registered = path.join(history, 'Legacy_Growth_List.csv');
  fs.writeFileSync(registered, 'company_name,email_address\nGrowth Co,growth@example.com\n', 'utf8');

  const unrelated = path.join(history, 'notes.txt');
  fs.writeFileSync(unrelated, 'ordinary notes without a contact schema', 'utf8');

  fs.writeFileSync(path.join(marketing, 'segment_registry.json'), JSON.stringify([
    { id: 'LEGACY_GROWTH', file: registered, exactRows: 1, category: 'FEDERAL' }
  ], null, 2));

  const service = new B12HistoricalUniverseDiscoveryService({ rootDir: root, historicalRoots: history, hashMaxBytes: 10 * 1024 * 1024 });
  const result = service.discover();

  assert.equal(result.ok, true);
  assert.equal(result.status, 'DISCOVERY_COMPLETE');
  assert.ok(result.inventory.historicalCandidateFiles >= 2);
  assert.ok(result.files.some(item => item.file === path.resolve(b12) && item.discoveryReason === 'B12_PATH_OR_FILENAME'));
  assert.ok(result.files.some(item => item.file === path.resolve(registered) && item.registryReferenced === true));
  assert.ok(result.files.some(item => item.file === path.resolve(master) && item.currentMaster === true));
  assert.ok(!result.files.some(item => item.file === path.resolve(unrelated)));
  assert.equal(result.safety.readOnlyDiscovery, true);
  assert.equal(result.safety.historicalSourcesModified, false);
  assert.equal(result.safety.emailSent, false);
  assert.ok(fs.existsSync(result.outputs.report));
  assert.ok(fs.existsSync(result.outputs.inventoryCsv));

  console.log('B12_HISTORICAL_UNIVERSE_DISCOVERY_TEST: GREEN');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
