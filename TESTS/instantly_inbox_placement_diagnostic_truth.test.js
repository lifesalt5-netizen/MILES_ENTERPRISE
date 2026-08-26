'use strict';
const assert = require('assert');
const { classify } = require('../SCRIPTS/DiagnoseInstantlyInboxPlacementTest');

assert.strictEqual(classify({ analyticsCount: 5, notSendingStatus: null, senderCount: 9, recipientCount: 92 }), 'ANALYTICS_AVAILABLE');
assert.strictEqual(classify({ analyticsCount: 0, notSendingStatus: 'ACCOUNT_LIMIT', senderCount: 9, recipientCount: 92 }), 'PROVIDER_NOT_SENDING_BLOCKER');
assert.strictEqual(classify({ analyticsCount: 0, notSendingStatus: null, senderCount: 9, recipientCount: 92 }), 'TEST_IN_PROGRESS_OR_AWAITING_ANALYTICS');
assert.strictEqual(classify({ analyticsCount: 0, notSendingStatus: null, senderCount: 9, recipientCount: 0 }), 'TEST_CREATED_WITHOUT_RECIPIENT_EXECUTION_EVIDENCE');
console.log('INSTANTLY_INBOX_PLACEMENT_DIAGNOSTIC_TRUTH=GREEN');
