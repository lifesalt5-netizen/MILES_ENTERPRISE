'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const routingDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'CRM_ROUTING');
const routingFile = path.join(routingDir, 'STATE_SLED_FL_REPLY_TO_CRM_ROUTING.json');

fs.mkdirSync(routingDir, { recursive: true });
const prior = fs.existsSync(routingFile) ? fs.readFileSync(routingFile, 'utf8') : null;

try {
  fs.writeFileSync(routingFile, JSON.stringify({ summary: { plannedRoutes: [] } }, null, 2));
  const service = require('../SERVICES/StateSledFlGovernedCrmWriteService');
  const dry = service.execute({ authorization: '', executeLive: false });
  assert.strictEqual(dry.ok, true);
  assert.strictEqual(dry.authorized, false);
  assert.strictEqual(dry.crmWritesExecuted, 0);
  assert.strictEqual(dry.safety.sendReplies, false);
  assert.strictEqual(dry.safety.createCalendarEvents, false);
  assert.strictEqual(dry.safety.mutateInstantlyCampaigns, false);
  console.log('STATE_SLED_FL_GOVERNED_CRM_WRITE_TEST=PASS');
} finally {
  if (prior === null) {
    try { fs.unlinkSync(routingFile); } catch (_) {}
  } else {
    fs.writeFileSync(routingFile, prior);
  }
}
