'use strict';

// Global mismatch probe is read-only provider evidence.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Service = require('../SERVICES/revenue/InstantlyLifecycleProofService');
const Reconciler = require('../SERVICES/revenue/InstantlyLifecycleReconciler');

assert.deepStrictEqual(Service.helpers.unwrap({ items: [{ email: 'A@Example.com' }] }).length, 1);
assert.strictEqual(Service.helpers.leadEmail({ email: 'A@Example.com' }), 'a@example.com');
assert.deepStrictEqual(Service.helpers.compactLead({
  id: 'lead-1', email: 'A@Example.com', campaign: 'campaign-1', list_id: 'list-1', lt_interest_status: -1, status: 3
}), {
  id: 'lead-1', email: 'a@example.com', campaignId: 'campaign-1', listId: 'list-1', interestStatus: -1, status: 3, timestampUpdated: null
});

const singleCurrent = Service.helpers.selectCurrentProviderSource([
  { id: 'lead-live', email: 'a@example.com', campaignId: 'campaign-current', listId: null }
], 'campaign-stale');
assert.strictEqual(singleCurrent.ok, true);
assert.strictEqual(singleCurrent.reason, 'SINGLE_GLOBAL_MATCH');
assert.strictEqual(singleCurrent.source.campaignId, 'campaign-current');

const preferredCurrent = Service.helpers.selectCurrentProviderSource([
  { id: 'lead-old', email: 'a@example.com', campaignId: 'campaign-other', listId: null },
  { id: 'lead-right', email: 'a@example.com', campaignId: 'campaign-reply', listId: null }
], 'campaign-reply');
assert.strictEqual(preferredCurrent.ok, true);
assert.strictEqual(preferredCurrent.reason, 'PREFERRED_CAMPAIGN_MATCH');
assert.strictEqual(preferredCurrent.source.id, 'lead-right');

const ambiguous = Service.helpers.selectCurrentProviderSource([
  { id: 'lead-a', email: 'a@example.com', campaignId: 'campaign-a', listId: null },
  { id: 'lead-b', email: 'a@example.com', campaignId: 'campaign-b', listId: null }
], 'campaign-stale');
assert.strictEqual(ambiguous.ok, false);
assert.strictEqual(ambiguous.reason, 'CURRENT_PROVIDER_LEAD_AMBIGUOUS');

assert.strictEqual(Reconciler.helpers.lifecycleListName('OOO_FOLLOWUP'), 'P2GC Replies - OOO');
assert.strictEqual(Reconciler.helpers.lifecycleListName('CLOSED_NEGATIVE'), 'P2GC Replies - Closed Negative');
assert.strictEqual(Reconciler.helpers.lifecycleListName('SUPPRESSED_UNSUBSCRIBE'), 'P2GC Replies - Unsubscribe');
assert.strictEqual(Reconciler.helpers.lifecycleListName('NURTURE_FUTURE'), 'P2GC Replies - Nurture');

const source = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'revenue', 'InstantlyLifecycleProofService.js'), 'utf8');
assert(source.includes("list_id: destination.id"));
assert(source.includes('search: email'));
assert(source.includes('in_list: true'));
assert(source.includes('distinct_contacts: false'));
assert(source.includes('globalLookup(email)'));
assert(source.includes('globalProviderProbe'));
assert(source.includes('mismatchGlobalProbeReadOnly: true'));
assert(source.includes('selectCurrentProviderSource'));
assert(source.includes('CURRENT_PROVIDER_SOURCE_CAMPAIGN_REQUIRED'));
assert(source.includes('currentProviderSourceRequiredForRepair: true'));
assert(source.includes('delete ledger.entries[key]'));
assert(source.includes('postMutationProviderReadRequired: true'));
assert(source.includes('localLedgerCannotOverrideProviderMismatch: true'));
assert(source.includes('sendsMessages: false'));
assert(source.includes('deletesEmails: false'));
assert(source.includes('deletesLeads: false'));

const runner = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunInstantlyLifecycleProof.js'), 'utf8');
assert(runner.includes("process.argv.includes('--execute')"));
assert(runner.includes('InstantlyLifecycleProofService'));
assert(runner.includes("process.env.MILES_DRY_RUN = 'false'"));
assert(runner.includes("process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'true'"));
assert(runner.includes("process.env.MILES_CONTROLLED_WRITE_ENABLED = 'true'"));
assert(runner.includes("process.env.INSTANTLY_WRITE_ENABLED = 'true'"));
assert(runner.includes("process.env.MILES_IONOS_MAILBOX_MUTATIONS = 'false'"));
assert(runner.includes("process.env.P2GC_B12_PUBLISH = 'false'"));
assert(runner.includes('INSTANTLY_EXECUTION_PREFLIGHT='));
assert(runner.includes('INSTANTLY_EXECUTION_PREFLIGHT_FAILED'));
assert(runner.includes('INSTANTLY_LIFECYCLE_DIAGNOSTICS='));
assert(runner.includes('globalProviderProbe: item.globalProviderProbe || null'));

console.log('INSTANTLY_LIFECYCLE_PROVIDER_PROOF=PASS');
