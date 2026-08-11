'use strict';

/*
  MILES Enterprise
  P1.5D — Instantly Revenue Message + Activation Readiness Gate
  READ ONLY. No campaign mutation or activation.
*/

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const instantly = require('../CONNECTORS/INSTANTLY/instantly');

const INPUT = path.join(__dirname, '..', 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_PRIORITY_DEDUP_SENDER_CAPACITY_GATE_LATEST.json');
const OUTPUT = path.join(__dirname, '..', 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_MESSAGE_ACTIVATION_GATE_LATEST.json');

function asArray(v) { return Array.isArray(v) ? v : []; }
function text(v) { return typeof v === 'string' ? v.trim() : ''; }

function campaignSequence(c) {
  return asArray(c?.sequences || c?.sequence || c?.steps || c?.email_sequence || c?.campaign_sequence);
}

function extractSteps(c) {
  const seq = campaignSequence(c);
  const steps = [];
  for (const item of seq) {
    const nested = asArray(item?.steps || item?.sequence_steps || item?.emails);
    if (nested.length) steps.push(...nested);
    else steps.push(item);
  }
  return steps;
}

function messageFields(step) {
  const variants = asArray(step?.variants || step?.variant || step?.emails);
  const items = variants.length ? variants : [step];
  return items.map(v => ({
    subject: text(v?.subject || v?.subject_line || v?.email_subject),
    body: text(v?.body || v?.body_text || v?.email_body || v?.content || v?.text),
    delay: v?.delay ?? step?.delay ?? step?.wait ?? null
  }));
}

function inspectMessages(campaign) {
  const steps = extractSteps(campaign);
  const variants = steps.flatMap(messageFields);
  const populated = variants.filter(v => v.subject || v.body);
  const missingSubject = populated.filter(v => !v.subject).length;
  const missingBody = populated.filter(v => !v.body).length;
  return {
    stepCountObserved: steps.length,
    messageVariantsObserved: variants.length,
    populatedMessageVariants: populated.length,
    missingSubject,
    missingBody,
    messageContentPresent: populated.length > 0 && missingBody === 0,
    messages: populated
  };
}

async function run() {
  if (!fs.existsSync(INPUT)) throw new Error(`Required P1.5C output not found: ${INPUT}`);
  const prior = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const candidates = asArray(prior.candidates);
  const results = [];

  for (const candidate of candidates) {
    let campaign = null;
    let fetchError = null;
    try { campaign = await instantly.getCampaign(candidate.campaignId); }
    catch (e) { fetchError = e.message; }

    const messageAudit = campaign ? inspectMessages(campaign) : {
      stepCountObserved: 0, messageVariantsObserved: 0, populatedMessageVariants: 0,
      missingSubject: 0, missingBody: 0, messageContentPresent: false, messages: []
    };

    const senderAccountsPresent = asArray(candidate.currentSenderEmails).length > 0;
    const eligibleContactsPresent = Number(candidate.eligibleUniqueContacts || 0) > 0;
    const sequencePresent = Number(candidate.sequenceStepCount || messageAudit.stepCountObserved || 0) > 0;
    const schedulePresent = candidate.schedulePresent === true;
    const senderVitalsUnknown = Number(candidate?.senderHealth?.unknown || 0) > 0;
    const senderVitalsUnhealthy = Number(candidate?.senderHealth?.unhealthy || 0) > 0;

    const blockers = [];
    if (fetchError) blockers.push('CAMPAIGN_FETCH_FAILED');
    if (!eligibleContactsPresent) blockers.push('NO_ELIGIBLE_UNIQUE_CONTACTS');
    if (!senderAccountsPresent) blockers.push('NO_SENDERS_ASSIGNED');
    if (!sequencePresent) blockers.push('NO_SEQUENCE');
    if (!messageAudit.messageContentPresent) blockers.push('MESSAGE_CONTENT_NOT_CONFIRMED');
    if (!schedulePresent) blockers.push('SCHEDULE_NOT_PRESENT');
    if (senderVitalsUnhealthy) blockers.push('SENDER_VITALS_UNHEALTHY');

    const warnings = [];
    if (senderVitalsUnknown) warnings.push('SENDER_VITALS_UNKNOWN_API_RETURNED_NO_EMAILS_SENT');
    if (Number(candidate.dailyLimit || 0) <= 0) warnings.push('CAMPAIGN_DAILY_LIMIT_ZERO_OR_UNSET');

    results.push({
      priority: candidate.priority,
      campaignId: candidate.campaignId,
      campaignName: candidate.campaignName,
      family: candidate.family,
      eligibleUniqueContacts: candidate.eligibleUniqueContacts,
      blockedSuppression: candidate.blockedSuppression,
      blockedActiveAcquisition: candidate.blockedActiveAcquisition,
      blockedHigherPriorityCandidate: candidate.blockedHigherPriorityCandidate,
      senderEmails: candidate.currentSenderEmails,
      senderHealth: candidate.senderHealth,
      sequenceStepCountPrior: candidate.sequenceStepCount,
      schedulePresent,
      dailyLimit: candidate.dailyLimit,
      messageAudit,
      blockers,
      warnings,
      readyForGovernedActivationAuthorization: blockers.length === 0,
      activationExecuted: false
    });
  }

  const ready = results.filter(r => r.readyForGovernedActivationAuthorization);
  const blocked = results.filter(r => !r.readyForGovernedActivationAuthorization);
  const output = {
    ok: true,
    gate: 'P1.5D_INSTANTLY_REVENUE_MESSAGE_ACTIVATION_READINESS_GATE',
    generatedAt: new Date().toISOString(),
    sourceGate: prior.gate || 'P1.5C',
    totals: {
      candidates: results.length,
      readyForGovernedActivationAuthorization: ready.length,
      blocked: blocked.length,
      eligibleUniqueContacts: results.reduce((n, r) => n + Number(r.eligibleUniqueContacts || 0), 0)
    },
    candidates: results,
    recommendedFirstBatch: ready
      .sort((a,b) => Number(a.priority||999)-Number(b.priority||999) || Number(b.eligibleUniqueContacts||0)-Number(a.eligibleUniqueContacts||0))
      .slice(0, 3)
      .map(r => ({ campaignId:r.campaignId, campaignName:r.campaignName, family:r.family, eligibleUniqueContacts:r.eligibleUniqueContacts, senderEmails:r.senderEmails, warnings:r.warnings })),
    safety: {
      readOnly: true,
      activateCampaigns: false,
      pauseCampaigns: false,
      updateCampaigns: false,
      moveLeads: false,
      uploadLeads: false,
      deleteLeads: false,
      deleteCampaigns: false,
      sendReplies: false,
      explicitAuthorizationRequiredBeforeAnyActivation: true
    },
    outputFile: OUTPUT
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  return output;
}

module.exports = { run };
