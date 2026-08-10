'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const store = path.join(root, 'DATA', 'CRM', 'canonical_crm.json');
const audit = path.join(root, 'DATA', 'CRM', 'canonical_crm_audit.jsonl');
const storeBak = fs.existsSync(store) ? fs.readFileSync(store) : null;
const auditBak = fs.existsSync(audit) ? fs.readFileSync(audit) : null;

function restore(file, buffer) {
  if (buffer) fs.writeFileSync(file, buffer);
  else if (fs.existsSync(file)) fs.unlinkSync(file);
}

try {
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify({ version: 1, records: [] }, null, 2));
  if (fs.existsSync(audit)) fs.unlinkSync(audit);

  const crm = require('../SERVICES/CanonicalCrmService');
  const a = crm.upsertIdentity({ email: 'owner@example.com', legalName: 'Example LLC', uei: 'ABC123' }, { source: 'TEST' });
  const b = crm.upsertIdentity({ email: 'OWNER@EXAMPLE.COM', companyDomain: 'example.com' }, { source: 'TEST' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.record.id, b.record.id);

  const s1 = crm.updateStage({ email: 'owner@example.com' }, 'Contacted', { type: 'OUTBOUND_SENT' });
  assert.equal(s1.record.stage, 'Contacted');

  const s2 = crm.updateStage({ email: 'owner@example.com' }, 'Engaged', { type: 'POSITIVE_REPLY' });
  assert.equal(s2.record.stage, 'Engaged');

  assert.throws(() => crm.updateStage({ email: 'owner@example.com' }, 'Target', { type: 'AUTO_ROUTE' }), /Stage regression blocked/);
  assert.throws(() => crm.updateStage({ email: 'owner@example.com' }, 'Qualified', {}), /routing event type is required/);

  const caps = crm.getCapabilities();
  assert.equal(caps.crmIdentityUpsert, true);
  assert.equal(caps.crmStageUpdate, true);
  assert.equal(caps.stages.length, 11);

  console.log('CANONICAL_CRM_SERVICE_TEST=PASS');
} finally {
  restore(store, storeBak);
  restore(audit, auditBak);
}
