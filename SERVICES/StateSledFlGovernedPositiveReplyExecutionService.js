'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const instantly = require('../CONNECTORS/INSTANTLY/connector');
const crm = require('./CanonicalCrmService');

const ROOT = process.cwd();
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'CONFIG', 'state_sled_fl_governed_positive_reply_execution_rules.json'), 'utf8'));

function loadDraftArtifact() {
  const file = path.join(ROOT, RULES.draftArtifact);
  if (!fs.existsSync(file)) {
    return { ok: false, drafts: [], error: 'Positive reply draft artifact not found.', file };
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ok: true, file, ...parsed };
}

function exactAuthorization(options = {}) {
  return options.authorization === RULES.requiredAuthorization && options.live === true;
}

function normalizeDraft(draft = {}) {
  return {
    email: draft.email || draft.to || draft.contactEmail || '',
    uei: draft.uei || '',
    domain: draft.domain || '',
    legalName: draft.company || draft.legalName || '',
    eaccount: draft.eaccount || draft.senderAccount || draft.sender || '',
    reply_to_uuid: draft.reply_to_uuid || draft.replyToUuid || draft.emailId || draft.email_id || '',
    subject: draft.subject || '',
    body: draft.body || draft.text || '',
    classification: draft.classification || 'POSITIVE'
  };
}

async function execute(options = {}) {
  const artifact = loadDraftArtifact();
  const drafts = Array.isArray(artifact.drafts) ? artifact.drafts : [];
  const normalized = drafts.map(normalizeDraft);
  const authorized = exactAuthorization(options);

  const invalid = normalized.filter(d => !d.eaccount || !d.reply_to_uuid || !d.subject || !d.body);

  const result = {
    ok: artifact.ok !== false && invalid.length === 0,
    gate: RULES.gate,
    campaignId: RULES.campaignId,
    campaignName: RULES.campaignName,
    draftsObserved: drafts.length,
    validSendCandidates: normalized.length - invalid.length,
    invalidSendCandidates: invalid.length,
    authorizationRequired: RULES.requiredAuthorization,
    authorizationSatisfied: authorized,
    liveRequested: options.live === true,
    sendsExecuted: 0,
    crmUpdatesExecuted: 0,
    results: [],
    safety: {
      sendRepliesWithoutAuthorization: false,
      createCalendarEvents: false,
      moveMailboxMessages: false,
      mutateCampaigns: false
    }
  };

  if (!authorized || normalized.length === 0 || invalid.length > 0) {
    result.executionSkipped = !authorized ? 'authorization_required' : normalized.length === 0 ? 'no_drafts' : 'invalid_drafts';
    persist(result);
    return result;
  }

  for (const draft of normalized) {
    const send = await instantly.execute({
      action: 'sendReply',
      payload: {
        eaccount: draft.eaccount,
        reply_to_uuid: draft.reply_to_uuid,
        subject: draft.subject,
        body: draft.body
      }
    });

    const sendResult = send?.result || send;
    const mutationExecuted = sendResult?.mutationExecuted !== false && sendResult?.dryRun !== true;
    let crmResult = null;

    if (mutationExecuted) {
      const upsert = crm.upsertIdentity({
        email: draft.email,
        uei: draft.uei,
        domain: draft.domain,
        legalName: draft.legalName,
        source: 'STATE_SLED_FL_POSITIVE_REPLY_SEND',
        campaignId: RULES.campaignId
      }, { source: 'P1.3AB' });

      crmResult = crm.updateStage(
        { email: draft.email, uei: draft.uei, domain: draft.domain, legalName: draft.legalName },
        RULES.crmStageAfterSuccessfulSend,
        { type: 'POSITIVE_REPLY_SENT', source: 'P1.3AB', campaignId: RULES.campaignId }
      );

      result.sendsExecuted += 1;
      result.crmUpdatesExecuted += 1;
      result.results.push({ send: sendResult, crm: crmResult, record: upsert.record });
    } else {
      result.results.push({ send: sendResult, crm: null });
    }
  }

  persist(result);
  return result;
}

function persist(result) {
  const file = path.join(ROOT, RULES.executionArtifact);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  result.outputFile = file;
}

module.exports = { execute, loadDraftArtifact, exactAuthorization, normalizeDraft };
