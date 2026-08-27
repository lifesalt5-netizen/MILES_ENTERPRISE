'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Service = require('../SERVICES/revenue/InstantlyLifecycleProofService');
const Reconciler = require('../SERVICES/revenue/InstantlyLifecycleReconciler');

assert.deepStrictEqual(Service.helpers.unwrap({ items: [{ email: 'A@Example.com' }] }).length, 1);
assert.strictEqual(Service.helpers.leadEmail({ email: 'A@Example.com' }), 'a@example.com');
assert.strictEqual(Reconciler.helpers.lifecycleListName('OOO_FOLLOWUP'), 'P2GC Replies - OOO');
assert.strictEqual(Reconciler.helpers.lifecycleListName('CLOSED_NEGATIVE'), 'P2GC Replies - Closed Negative');
assert.strictEqual(Reconciler.helpers.lifecycleListName('SUPPRESSED_UNSUBSCRIBE'), 'P2GC Replies - Unsubscribe');
assert.strictEqual(Reconciler.helpers.lifecycleListName('NURTURE_FUTURE'), 'P2GC Replies - Nurture');

const source = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'revenue', 'InstantlyLifecycleProofService.js'), 'utf8');
assert(source.includes("list_id: destination.id"));
assert(source.includes('search: email'));
assert(source.includes('in_list: true'));
assert(source.includes('delete ledger.entries[key]'));
assert(source.includes('postMutationProviderReadRequired: true'));
assert(source.includes('localLedgerCannotOverrideProviderMismatch: true'));
assert(source.includes('sendsMessages: false'));
assert(source.includes('deletesEmails: false'));
assert(source.includes('deletesLeads: false'));

const runner = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunInstantlyLifecycleProof.js'), 'utf8');
assert(runner.includes("process.argv.includes('--execute')"));
assert(runner.includes('InstantlyLifecycleProofService'));

console.log('INSTANTLY_LIFECYCLE_PROVIDER_PROOF=PASS');
