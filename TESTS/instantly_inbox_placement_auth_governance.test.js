'use strict';

const assert = require('assert');
const { senderStatus } = require('../SCRIPTS/AuditInstantlyInboxPlacement');

assert.strictEqual(senderStatus({ samples: 5, inboxPct: 100, spamPct: 0, spfPassPct: 100, dkimPassPct: 100, dmarcPassPct: 100 }), 'ACTIVE');
assert.strictEqual(senderStatus({ samples: 5, inboxPct: 100, spamPct: 0, spfPassPct: 100, dkimPassPct: 100, dmarcPassPct: 0 }), 'WATCH');
assert.strictEqual(senderStatus({ samples: 5, inboxPct: 100, spamPct: 0, spfPassPct: 0, dkimPassPct: 100, dmarcPassPct: 100 }), 'WATCH');
assert.strictEqual(senderStatus({ samples: 5, inboxPct: 79, spamPct: 0, spfPassPct: 100, dkimPassPct: 100, dmarcPassPct: 100 }), 'WATCH');
assert.strictEqual(senderStatus({ samples: 0, inboxPct: 0, spamPct: 0, spfPassPct: 0, dkimPassPct: 0, dmarcPassPct: 0 }), 'UNVERIFIED');

require('./revenue_acceptance_sprint.test.js');

console.log('INSTANTLY_INBOX_PLACEMENT_AUTH_GOVERNANCE=GREEN');
