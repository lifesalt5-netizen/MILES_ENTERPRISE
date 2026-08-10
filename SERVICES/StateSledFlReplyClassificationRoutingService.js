'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, 'CONFIG', 'state_sled_fl_reply_routing_rules.json');

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function getBody(email = {}) {
  return String(
    email.body?.text ||
    email.body?.html ||
    email.text ||
    email.html ||
    email.body ||
    email.content ||
    email.snippet ||
    email.subject ||
    ''
  ).toLowerCase();
}

function classifyReply(email = {}) {
  const text = getBody(email);

  if (/out of office|automatic reply|auto.?reply|away from the office|on vacation|return(?:ing)? on|will be back/.test(text)) {
    return { replyClass: 'OOO', confidence: 'HIGH', reason: 'OOO language detected' };
  }

  if (/unsubscribe|remove me|do not contact|don't contact|not interested|no thanks|stop emailing|stop email|take me off/.test(text)) {
    return { replyClass: 'NEGATIVE', confidence: 'HIGH', reason: 'Negative/suppression language detected' };
  }

  if (/delivery failed|undeliverable|mailbox full|address not found|does not exist|blocked|bounce|550 |554 |smtp/.test(text)) {
    return { replyClass: 'TECHNICAL', confidence: 'HIGH', reason: 'Technical delivery language detected' };
  }

  if (/interested|yes|let's talk|lets talk|schedule|meeting|calendar|availability|send me times|book|call me|learn more|tell me more|sounds good|worth a conversation/.test(text)) {
    return { replyClass: 'POSITIVE', confidence: 'HIGH', reason: 'Positive intent language detected' };
  }

  return { replyClass: 'NEUTRAL', confidence: 'LOW', reason: 'No decisive rule matched' };
}

function normalizeEmail(email = {}) {
  return String(email.from_address || email.from || email.sender || email.email || '').trim().toLowerCase();
}

async function run() {
  const rules = loadRules();
  const connector = require('../CONNECTORS/INSTANTLY/connector');

  const replyResult = await connector.execute({
    action: 'readReplies',
    payload: {
      campaign_id: rules.campaignId,
      limit: 100,
      latest_of_thread: true,
      sort_order: 'desc'
    }
  });

  if (replyResult?.ok === false) {
    throw new Error(`Instantly reply intake failed: ${replyResult.error || 'unknown error'}`);
  }

  const replies = unwrapItems(replyResult?.emails);
  const classified = replies.map(email => {
    const classification = classifyReply(email);
    const route = rules.routing[classification.replyClass];

    return {
      id: email.id || email.email_id || null,
      from: normalizeEmail(email),
      subject: email.subject || '',
      replyClass: classification.replyClass,
      confidence: classification.confidence,
      reason: classification.reason,
      proposedTargetStage: route?.targetStage || null,
      meetingCandidate: route?.meetingCandidate === true,
      requiresHumanReplyApproval: route?.requiresHumanReplyApproval === true,
      suppressFutureOutreach: route?.suppressFutureOutreach === true,
      technicalSuppression: route?.technicalSuppression === true,
      futureFollowUp: route?.futureFollowUp === true
    };
  });

  const counts = Object.fromEntries(rules.replyClasses.map(name => [name, 0]));
  for (const row of classified) counts[row.replyClass] += 1;

  const summary = {
    ok: true,
    gate: rules.gate,
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    repliesObserved: replies.length,
    classificationCounts: counts,
    routingCandidates: classified,
    readyForCrmRoutingImplementation: true,
    safety: rules.safety,
    mutationAttempted: false
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'REPLY_ROUTING');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_REPLY_CLASSIFICATION_ROUTING.json');
  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  summary.outputFile = outputFile;

  return summary;
}

module.exports = {
  run,
  classifyReply,
  normalizeEmail,
  unwrapItems
};
