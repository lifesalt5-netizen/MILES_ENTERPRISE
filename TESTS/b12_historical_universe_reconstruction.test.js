'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const B12HistoricalUniverseReconstructionService = require('../SERVICES/revenue/B12HistoricalUniverseReconstructionService');

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-b12-reconstruct-'));
  try {
    const outbound = path.join(root, 'DATA', 'OUTBOUND');
    const discoveryDir = path.join(root, 'DATA', 'revenue', 'b12_reconciliation', 'discovery');
    const replyDir = path.join(root, 'DATA', 'runtime', 'revenue', 'replies');
    const sourceDir = path.join(root, 'historical_b12');
    fs.mkdirSync(outbound, { recursive: true });
    fs.mkdirSync(discoveryDir, { recursive: true });
    fs.mkdirSync(replyDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });

    const master = path.join(outbound, 'MASTER_DEDUPED_ALL_SEGMENTS.csv');
    fs.writeFileSync(master, [
      'email,company,state,uei,website',
      'current@acme.com,Acme LLC,FL,UEIACME,https://acme.com',
      'new@beta.com,Beta Inc,FL,UEIBETA,https://beta.com'
    ].join('\n') + '\n');

    const source = path.join(sourceDir, 'B12_campaign_2025-10_contacts.csv');
    fs.writeFileSync(source, [
      'email,company,state,uei,campaign',
      'current@acme.com,Acme LLC,FL,UEIACME,B12 GSA Control',
      'old@beta.com,Beta Inc,FL,UEIBETA,B12 GSA Control',
      'bad-email,Gamma LLC,FL,UEIGAMMA,B12 GSA Control',
      ',Delta LLC,FL,UEIDELTA,B12 GSA Control',
      'unsub@epsilon.com,Epsilon LLC,FL,UEIEPS,B12 GSA Control',
      'unknown@zeta.com,Zeta LLC,FL,UEIZETA,B12 GSA Control',
      'current@acme.com,Acme LLC,FL,UEIACME,B12 GSA Control'
    ].join('\n') + '\n');

    fs.writeFileSync(path.join(replyDir, 'global_suppression_master.json'), JSON.stringify({
      version: 1,
      entries: [{ email: 'unsub@epsilon.com', reason: 'UNSUBSCRIBE', category: 'UNSUBSCRIBE', active: true }]
    }, null, 2));

    const discovery = {
      ok: true,
      status: 'DISCOVERY_COMPLETE',
      historicalWindow: { start: '2025-09-01', endExclusive: '2026-03-01' },
      inventory: { historicalCandidateFiles: 1, parseableCandidateFiles: 1 },
      files: [{
        file: source,
        currentMaster: false,
        parseableNow: true,
        sha256: hash(source),
        registryReferenced: true,
        discoveryReason: 'REGISTERED_MARKETING_SOURCE',
        contactHeaderEvidence: ['email','company']
      }]
    };
    fs.writeFileSync(path.join(discoveryDir, 'latest_b12_historical_universe_discovery.json'), JSON.stringify(discovery, null, 2));

    const result = await new B12HistoricalUniverseReconstructionService({ rootDir: root }).run();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 'B12_RECONSTRUCTION_COMPLETE_WITH_EXPLICIT_DISPOSITIONS');
    assert.strictEqual(result.historicalUniverse.rawRows, 7);
    assert.strictEqual(result.historicalUniverse.legitimateDuplicateRows, 1);
    assert.strictEqual(result.historicalUniverse.canonicalHistoricalContacts, 6);
    assert.strictEqual(result.historicalUniverse.canonicalDispositionCounts.CURRENT_MASTER, 1);
    assert.strictEqual(result.historicalUniverse.canonicalDispositionCounts.COMPANY_STILL_VALID_NEW_CONTACT_NEEDED, 1);
    assert.strictEqual(result.historicalUniverse.canonicalDispositionCounts.INVALID_EMAIL, 1);
    assert.strictEqual(result.historicalUniverse.canonicalDispositionCounts.NEEDS_RE_ENRICHMENT, 1);
    assert.strictEqual(result.historicalUniverse.canonicalDispositionCounts.UNSUBSCRIBED, 1);
    assert.strictEqual(result.historicalUniverse.canonicalDispositionCounts.UNKNOWN_INVESTIGATE, 1);
    assert.strictEqual(result.historicalUniverse.provenLostDuringMigration, 0);
    assert.strictEqual(result.historicalUniverse.excludedWithoutValidReason, 0);
    assert.strictEqual(result.truthRules.absenceFromCurrentMasterDoesNotEqualLostDuringMigration, true);
    assert.strictEqual(result.truthRules.noHistoricalRowsSilentlyDropped, true);
    assert(fs.existsSync(result.outputs.report));
    assert(fs.existsSync(result.outputs.canonicalContactsCsv));
    assert(fs.existsSync(result.outputs.rowDispositionsCsv));

    const helper = B12HistoricalUniverseReconstructionService.helpers || require('../SERVICES/revenue/B12HistoricalUniverseReconstructionService').helpers;
    assert.strictEqual(helper.dispositionFor({ rawEmail:'orphan@unknown.com', email:'orphan@unknown.com', emailValid:true, uei:'', cage:'', domain:'unknown.com', companyNorm:'unknown', state:'FL' }, { emails:new Set(), companyKeys:new Set() }, null).disposition, 'UNKNOWN_INVESTIGATE');

    console.log('B12_HISTORICAL_UNIVERSE_RECONSTRUCTION_TEST=PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
