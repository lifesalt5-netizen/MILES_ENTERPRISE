'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wrapper = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunIonosInboxCleanup.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'revenue', 'IonosInboxCleanupService.js'), 'utf8');
const governed = fs.readFileSync(path.join(__dirname, '..', 'CONNECTORS', 'IONOS', 'imap_governed.js'), 'utf8');

assert(wrapper.includes("process.argv.includes('--execute')"));
assert(wrapper.includes('IonosInboxCleanupService'));
assert(service.includes("mode: execute ? 'GOVERNED_MAILBOX_MOVE_WITH_POST_VERIFY' : 'PLAN_ONLY'"));
assert(service.includes('preservesActionableHumanRepliesInInbox: true'));
assert(service.includes('remainingRoutableNoise'));
assert(service.includes('MILES-JUNK'));
assert(governed.includes('UID MOVE'));
assert(!/EXPUNGE/i.test(governed));
assert(!/\\Deleted/i.test(governed));

console.log('IONOS_INBOX_CLEANUP_CONTROL=PASS');
