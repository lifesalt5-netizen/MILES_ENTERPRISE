'use strict';

const fs = require('fs');
const path = require('path');
const GlobalSuppressionService = require('./GlobalSuppressionService');

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function clean(v) { return String(v || '').trim(); }
function emailKey(v) { return clean(v).toLowerCase(); }
function ms(v) { const n = Date.parse(clean(v)); return Number.isFinite(n) ? n : 0; }
function addDays(iso, days) {
  const base = ms(iso) || Date.now();
  return new Date(base + Number(days || 0) * 86400000).toISOString();
}

function identityKey(row = {}) {
  return clean(row.conversationKey) || `${emailKey(row.contactEmail || row.from || row.email)}|${clean(row.campaignId)}`;
}

function latestQualifiedAt(record = {}) {
  const direct = record.lastQualifiedReplyAt || record.qualifiedAt || record.updatedAt || '';
  return ms(direct) ? new Date(ms(direct)).toISOString() : null;
}

function draftFor(candidate = {}) {
  const category = clean(candidate.category).toUpperCase();
  if (category === 'OOO') {
    return 'Following up now that you should be back. I wanted to keep this tied to the original conversation rather than restart with another generic message. If it is useful, I can send the current P2GC view of the specific government-contracting issue we originally flagged.';
  }
  if (category === 'NOT_NOW') {
    return 'You asked me to circle back around now. Rather than restart the conversation, I can refresh the original government-contracting issue we discussed and send the most relevant current intelligence or next-step recommendation. If useful, I can send that over.';
  }
  return 'Wanted to close the loop on the item you responded to. I can send the specific current finding and the most practical next step without putting you through a broad sales presentation. If that would help, I can send it over.';
}

class QualifiedProspectNurtureService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.now = options.now || (() => new Date());
    this.rulesPath = options.rulesPath || path.join(this.rootDir, 'CONFIG', 'p2gc_qualified_nurture_rules.json');
    this.rules = options.rules || readJson(this.rulesPath, {});
    this.followupQueuePath = options.followupQueuePath || path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'replies', 'followup_queue.json');
    this.qualifiedQueuePath = options.qualifiedQueuePath || path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'replies', 'qualified_reply_queue.json');
    this.crmPath = options.crmPath || path.join(this.rootDir, 'DATA', 'CRM', 'canonical_crm.json');
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'nurture');
    this.queuePath = path.join(this.outputDir, 'nurture_execution_queue.json');
    this.statePath = path.join(this.outputDir, 'nurture_state.json');
    this.latestPath = path.join(this.outputDir, 'nurture_latest.json');
    this.suppression = options.suppression || new GlobalSuppressionService({ rootDir: this.rootDir });
    this.connector = options.connector || null;
  }

  stopStages() {
    return new Set(Array.isArray(this.rules.stop_stages) ? this.rules.stop_stages : ['Meeting Set','Meeting Held','Proposal','Negotiation','Won','Lost','Client']);
  }

  loadCrmRecords() {
    const payload = readJson(this.crmPath, { records: [] });
    return Array.isArray(payload?.records) ? payload.records : [];
  }

  findCrmRecord(records, candidate = {}) {
    const email = emailKey(candidate.contactEmail || candidate.from || candidate.email);
    const campaignId = clean(candidate.campaignId);
    return records.find(r => email && emailKey(r.email || r.contactEmail) === email) ||
      records.find(r => campaignId && clean(r.campaignId || r.campaign_id) === campaignId && emailKey(r.email || r.contactEmail) === email) ||
      null;
  }

  isStopped(record) {
    return Boolean(record && this.stopStages().has(clean(record.stage)));
  }

  sourceCandidates(crmRecords) {
    const followups = readJson(this.followupQueuePath, []);
    const qualified = readJson(this.qualifiedQueuePath, []);
    const candidates = [];

    for (const row of Array.isArray(followups) ? followups : []) {
      const category = clean(row.category).toUpperCase();
      if (!['NOT_NOW', 'OOO'].includes(category)) continue;
      candidates.push({
        ...row,
        sourceType: category,
        category,
        contactEmail: emailKey(row.contactEmail || row.from || row.email),
        dueAt: row.followUpAt || row.followupAt || row.timestamp || row.processedAt || null,
        sourceQueue: 'FOLLOWUP_QUEUE'
      });
    }

    const qualifiedByIdentity = new Map();
    for (const row of Array.isArray(qualified) ? qualified : []) {
      qualifiedByIdentity.set(identityKey(row), row);
    }

    for (const record of crmRecords) {
      if (clean(record.stage) !== 'Qualified') continue;
      const qualifiedAt = latestQualifiedAt(record);
      if (!qualifiedAt) continue;
      const queueMatch = [...qualifiedByIdentity.values()].find(q => {
        const qEmail = emailKey(q.contactEmail || q.from || q.email);
        return qEmail && qEmail === emailKey(record.email || record.contactEmail) &&
          (!record.campaignId || !q.campaignId || clean(record.campaignId) === clean(q.campaignId));
      }) || {};
      candidates.push({
        ...queueMatch,
        sourceType: 'QUALIFIED_NO_MEETING',
        category: 'QUALIFIED_NO_MEETING',
        contactEmail: emailKey(record.email || record.contactEmail),
        companyName: record.companyName || record.legalName || queueMatch.companyName || '',
        campaignId: record.campaignId || queueMatch.campaignId || '',
        leadId: record.leadId || queueMatch.leadId || '',
        dueAt: addDays(qualifiedAt, Number(this.rules?.cadence?.QUALIFIED_NO_MEETING?.first_touch_after_days || 2)),
        sourceQueue: 'CRM_QUALIFIED',
        crmRecordId: record.id || null
      });
    }

    return candidates;
  }

  stateFor(key) {
    const state = readJson(this.statePath, { version: 1, conversations: {} });
    state.conversations = state.conversations || {};
    return { state, item: state.conversations[key] || { attempts: 0, lastPlannedAt: null, lastExecutedAt: null } };
  }

  nextDue(candidate, stateItem) {
    const category = clean(candidate.category).toUpperCase();
    const cadence = this.rules?.cadence?.[category] || {};
    if (!stateItem.attempts) return candidate.dueAt || new Date(this.now().getTime()).toISOString();
    const offsets = Array.isArray(cadence.additional_days) ? cadence.additional_days : [];
    const index = Math.max(0, Number(stateItem.attempts) - 1);
    if (index >= offsets.length) return null;
    return addDays(stateItem.lastExecutedAt || stateItem.lastPlannedAt || candidate.dueAt, offsets[index]);
  }

  maxTouches(category) {
    return Number(this.rules?.cadence?.[clean(category).toUpperCase()]?.max_touches || 1);
  }

  async resolveThreadIdentity(candidate) {
    if (candidate.reply_to_uuid && candidate.eaccount) {
      return { reply_to_uuid: candidate.reply_to_uuid, eaccount: candidate.eaccount, subject: candidate.subject || '' };
    }
    if (!candidate.emailId || !this.connector || typeof this.connector.execute !== 'function') {
      return { reply_to_uuid: candidate.reply_to_uuid || '', eaccount: candidate.eaccount || '', subject: candidate.subject || '' };
    }
    try {
      const response = await this.connector.execute({ action: 'getEmail', payload: { id: candidate.emailId } });
      const email = response?.email?.items?.[0] || response?.email?.data || response?.email || response?.result || {};
      return {
        reply_to_uuid: clean(email.reply_to_uuid || email.uuid || email.id || candidate.emailId),
        eaccount: clean(email.eaccount || email.sender_account || email.account_email || ''),
        subject: clean(email.subject || candidate.subject || '')
      };
    } catch {
      return { reply_to_uuid: '', eaccount: '', subject: candidate.subject || '' };
    }
  }

  async buildQueue(options = {}) {
    const execute = options.execute === true;
    const crmRecords = this.loadCrmRecords();
    const candidates = this.sourceCandidates(crmRecords);
    const nowMs = this.now().getTime();
    const queue = [];
    const skipped = [];
    const state = readJson(this.statePath, { version: 1, conversations: {} });
    state.conversations = state.conversations || {};

    for (const candidate of candidates) {
      const key = identityKey(candidate);
      const email = emailKey(candidate.contactEmail || candidate.from || candidate.email);
      const crmRecord = this.findCrmRecord(crmRecords, candidate);
      const stateItem = state.conversations[key] || { attempts: 0, lastPlannedAt: null, lastExecutedAt: null };

      if (!email) {
        skipped.push({ key, reason: 'MISSING_EMAIL' });
        continue;
      }
      if (this.suppression.isSuppressed(email)) {
        skipped.push({ key, email, reason: 'GLOBAL_SUPPRESSION' });
        continue;
      }
      if (this.isStopped(crmRecord)) {
        skipped.push({ key, email, reason: `CRM_STOP_STAGE_${clean(crmRecord.stage).replace(/\s+/g, '_').toUpperCase()}` });
        continue;
      }
      if (Number(stateItem.attempts || 0) >= this.maxTouches(candidate.category)) {
        skipped.push({ key, email, reason: 'MAX_TOUCHES_REACHED' });
        continue;
      }

      const dueAt = this.nextDue(candidate, stateItem);
      if (!dueAt || ms(dueAt) > nowMs) {
        skipped.push({ key, email, reason: 'NOT_DUE', dueAt });
        continue;
      }

      const thread = await this.resolveThreadIdentity(candidate);
      const body = draftFor(candidate);
      const executable = Boolean(thread.reply_to_uuid && thread.eaccount && body);
      const operation = {
        id: `NURTURE_${Buffer.from(key).toString('base64url').slice(0, 48)}_${Number(stateItem.attempts || 0) + 1}`,
        key,
        type: 'P2GC_QUALIFIED_NURTURE_TOUCH',
        category: candidate.category,
        sourceQueue: candidate.sourceQueue,
        contactEmail: email,
        companyName: candidate.companyName || crmRecord?.companyName || crmRecord?.legalName || '',
        campaignId: candidate.campaignId || crmRecord?.campaignId || '',
        leadId: candidate.leadId || crmRecord?.leadId || '',
        crmRecordId: crmRecord?.id || candidate.crmRecordId || null,
        crmStage: crmRecord?.stage || null,
        dueAt,
        touchNumber: Number(stateItem.attempts || 0) + 1,
        contentRoute: this.rules?.content_routes?.[candidate.category] || 'RELEVANT_INTELLIGENCE',
        provider: 'INSTANTLY',
        connector: 'INSTANTLY',
        action: executable ? 'replyToEmail' : 'RESOLVE_THREAD_AND_REPLY',
        reply_to_uuid: thread.reply_to_uuid,
        eaccount: thread.eaccount,
        subject: /^re:/i.test(thread.subject || candidate.subject || '') ? (thread.subject || candidate.subject) : `Re: ${thread.subject || candidate.subject || 'Government contracting'}`,
        body: { text: body },
        status: executable ? 'READY_FOR_GOVERNED_EXECUTION' : 'THREAD_IDENTITY_REQUIRED',
        controlledWriteRequired: true,
        executeRequested: execute,
        generatedAt: new Date(this.now().getTime()).toISOString()
      };
      queue.push(operation);
      state.conversations[key] = {
        ...stateItem,
        category: candidate.category,
        email,
        campaignId: operation.campaignId,
        attempts: Number(stateItem.attempts || 0),
        lastPlannedAt: operation.generatedAt,
        nextDueAt: dueAt,
        lastOperationId: operation.id
      };
    }

    writeJsonAtomic(this.queuePath, queue);
    writeJsonAtomic(this.statePath, state);

    const report = {
      ok: true,
      service: 'P2GC_QUALIFIED_PROSPECT_NURTURE',
      generatedAt: new Date(this.now().getTime()).toISOString(),
      candidatesObserved: candidates.length,
      dueQueued: queue.length,
      executableNow: queue.filter(x => x.status === 'READY_FOR_GOVERNED_EXECUTION').length,
      skippedCount: skipped.length,
      queue,
      skipped,
      safety: {
        suppressionChecked: true,
        crmStopStageChecked: true,
        genericColdRecycle: false,
        originalThreadPreferred: true,
        controlledWriteRequired: true,
        autoSendPerformedByBuild: false
      }
    };
    writeJsonAtomic(this.latestPath, report);
    return report;
  }

  async executeReady(report = null) {
    const current = report || readJson(this.latestPath, { queue: [] });
    if (!this.connector || typeof this.connector.execute !== 'function') {
      return { ok: false, status: 'INSTANTLY_CONNECTOR_REQUIRED', executed: 0, results: [] };
    }
    const state = readJson(this.statePath, { version: 1, conversations: {} });
    state.conversations = state.conversations || {};
    const results = [];

    for (const op of Array.isArray(current.queue) ? current.queue : []) {
      if (op.status !== 'READY_FOR_GOVERNED_EXECUTION') continue;
      const result = await this.connector.execute({ action: 'replyToEmail', payload: {
        eaccount: op.eaccount,
        reply_to_uuid: op.reply_to_uuid,
        subject: op.subject,
        body: op.body
      } });
      const executed = result?.mutationExecuted === true && result?.ok !== false;
      results.push({ id: op.id, key: op.key, executed, result });
      if (executed) {
        const item = state.conversations[op.key] || { attempts: 0 };
        item.attempts = Number(item.attempts || 0) + 1;
        item.lastExecutedAt = new Date(this.now().getTime()).toISOString();
        item.lastOperationId = op.id;
        state.conversations[op.key] = item;
      }
    }

    writeJsonAtomic(this.statePath, state);
    return {
      ok: results.every(x => x.executed || x.result?.status === 'DRY_RUN'),
      status: 'GOVERNED_NURTURE_EXECUTION_COMPLETE',
      attempted: results.length,
      executed: results.filter(x => x.executed).length,
      dryRunOrBlocked: results.filter(x => !x.executed).length,
      results
    };
  }

  async runOnce(options = {}) {
    const report = await this.buildQueue(options);
    if (options.execute !== true) return report;
    return { report, execution: await this.executeReady(report) };
  }
}

module.exports = QualifiedProspectNurtureService;
module.exports.helpers = { readJson, writeJsonAtomic, identityKey, addDays, draftFor };
