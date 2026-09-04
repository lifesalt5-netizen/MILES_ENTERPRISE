'use strict';

const assert = require('assert');
const IonosInboxHygieneProductionLoopService = require('../SERVICES/revenue/IonosInboxHygieneProductionLoopService');
const { CATEGORIES } = require('../SERVICES/revenue/ReplyIntelligenceService');

const clients = new Set(['client@example.com']);

assert.strictEqual(
  IonosInboxHygieneProductionLoopService.safeFolderFor(
    { category:CATEGORIES.UNKNOWN, humanReply:false },
    { from:'noreply-dmarc-support@google.com', subject:'Report domain: pathwaysgsa.com Submitter: google.com DMARC aggregate report' },
    clients
  ),
  'MILES-SYSTEM',
  'Google DMARC aggregate reports must route out of the human inbox'
);

assert.strictEqual(
  IonosInboxHygieneProductionLoopService.safeFolderFor(
    { category:CATEGORIES.AUTO_REPLY, humanReply:false },
    { from:'dmarcreport@microsoft.com', subject:'DMARC Aggregate Report' },
    clients
  ),
  'MILES-SYSTEM',
  'Microsoft DMARC aggregate reports must route to the canonical system folder'
);

assert.strictEqual(
  IonosInboxHygieneProductionLoopService.safeFolderFor(
    { category:CATEGORIES.MEETING_INTENT, humanReply:true },
    { from:'Client <client@example.com>', subject:'Can we meet tomorrow?' },
    clients
  ),
  null,
  'legitimate client mail must remain in Inbox'
);

console.log('IONOS_CONTINUOUS_DMARC_ROUTING=PASS');
