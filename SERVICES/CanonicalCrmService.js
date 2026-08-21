'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
const RULES_FILE = path.join(ROOT, 'CONFIG', 'canonical_crm_rules.json');

function loadRules() {
  if (!fs.existsSync(RULES_FILE)) throw new Error(`Canonical CRM rules missing: ${RULES_FILE}`);
  return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8').replace(/^\uFEFF/, ''));
}

const RULES = loadRules();
const STORE = path.join(ROOT, RULES.storageFile);
const AUDIT = path.join(ROOT, RULES.auditFile);

function ensureDirs() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.mkdirSync(path.dirname(AUDIT), { recursive: true });
}

function loadStore() {
  ensureDirs();
  if (!fs.existsSync(STORE)) return { version: 1, records: [] };
  const parsed = JSON.parse(fs.readFileSync(STORE, 'utf8').replace(/^\uFEFF/, ''));
  return parsed && Array.isArray(parsed.records) ? parsed : { version: 1, records: [] };
}

function saveStore(store) {
  ensureDirs();
  const tmp = `${STORE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, STORE);
}

function audit(event) {
  ensureDirs();
  fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', 'utf8');
}

function norm(v) { return String(v || '').trim(); }
function lower(v) { return norm(v).toLowerCase(); }

function identityCandidates(input = {}) {
  return {
    email: lower(input.email || input.contactEmail || input.inviteeEmail),
    uei: norm(input.uei).toUpperCase(),
    companyDomain: lower(input.companyDomain || input.domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''),
    legalName: lower(input.legalName || input.companyName || input.company)
  };
}

function findRecord(store, input) {
  const ids = identityCandidates(input);
  for (const key of RULES.identityPriority) {
    if (!ids[key]) continue;
    const found = store.records.find(r => identityCandidates(r)[key] === ids[key]);
    if (found) return found;
  }
  return null;
}

function upsertIdentity(input = {}, context = {}) {
  const store = loadStore();
  let record = findRecord(store, input);
  const now = new Date().toISOString();
  const created = !record;
  if (!record) {
    record = {
      id: `CRM-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      stage: 'Target',
      createdAt: now,
      stageHistory: []
    };
    store.records.push(record);
  }
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') record[k] = v;
  }
  record.updatedAt = now;
  saveStore(store);
  audit({ type: 'IDENTITY_UPSERT', recordId: record.id, created, source: context.source || null });
  return { ok: true, created, record };
}

function updateStage(identity = {}, nextStage, event = {}) {
  if (!RULES.stages.includes(nextStage)) throw new Error(`Invalid CRM stage: ${nextStage}`);
  if (RULES.requireRoutingEventForStageChange && !event.type) throw new Error('routing event type is required for stage change');
  const store = loadStore();
  const record = findRecord(store, identity);
  if (!record) throw new Error('CRM identity not found');
  const currentIndex = RULES.stages.indexOf(record.stage || 'Target');
  const nextIndex = RULES.stages.indexOf(nextStage);
  if (!RULES.allowAutomaticStageRegression && nextIndex < currentIndex && event.allowRegression !== true) {
    throw new Error(`Stage regression blocked: ${record.stage} -> ${nextStage}`);
  }
  const previousStage = record.stage || 'Target';
  if (previousStage === nextStage) {
    return { ok: true, unchanged: true, record };
  }
  record.stage = nextStage;
  record.updatedAt = new Date().toISOString();
  record.stageHistory = Array.isArray(record.stageHistory) ? record.stageHistory : [];
  record.stageHistory.push({ at: record.updatedAt, from: previousStage, to: nextStage, event });
  saveStore(store);
  audit({ type: 'STAGE_UPDATE', recordId: record.id, from: previousStage, to: nextStage, event });
  return { ok: true, unchanged: false, record };
}

function advanceStageAtLeast(identity = {}, minimumStage, event = {}) {
  if (!RULES.stages.includes(minimumStage)) throw new Error(`Invalid CRM stage: ${minimumStage}`);
  const store = loadStore();
  const record = findRecord(store, identity);
  if (!record) throw new Error('CRM identity not found');
  const currentIndex = RULES.stages.indexOf(record.stage || 'Target');
  const minimumIndex = RULES.stages.indexOf(minimumStage);
  if (currentIndex >= minimumIndex) {
    return { ok: true, unchanged: true, record, minimumStage };
  }
  return updateStage(identity, minimumStage, event);
}

function getByIdentity(identity = {}) {
  const store = loadStore();
  return findRecord(store, identity);
}

function listRecords() {
  return loadStore().records;
}

function getCapabilities() {
  return {
    crmIdentityUpsert: true,
    crmStageUpdate: true,
    crmAdvanceStageAtLeast: true,
    stages: [...RULES.stages],
    storageFile: STORE,
    auditFile: AUDIT,
    rootDir: ROOT
  };
}

module.exports = {
  upsertIdentity,
  updateStage,
  advanceStageAtLeast,
  getByIdentity,
  listRecords,
  getCapabilities,
  identityCandidates
};
