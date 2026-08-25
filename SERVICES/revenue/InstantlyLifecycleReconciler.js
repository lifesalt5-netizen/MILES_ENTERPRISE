'use strict';

const fs = require('fs');
const path = require('path');
const instantly = require('../../CONNECTORS/INSTANTLY/instantly');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const GlobalSuppressionService = require('./GlobalSuppressionService');
const { CATEGORIES } = ReplyIntelligenceService;

function clean(v) { return String(v || '').trim(); }
function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1','true','yes','y','on'].includes(String(raw).trim().toLowerCase());
}
function mayMutate() {
  return envBool('MILES_DRY_RUN', true) === false &&
    envBool('MILES_ALLOW_INSTANTLY_MUTATIONS', false) === true &&
    envBool('MILES_CONTROLLED_WRITE_ENABLED', false) === true &&
    envBool('INSTANTLY_WRITE_ENABLED', false) === true;
}
function bucketFor(category) {
  switch (category) {
    case CATEGORIES.PRICING_QUESTION:
    case CATEGORIES.MEETING_INTENT:
    case CATEGORIES.INTERESTED:
    case CATEGORIES.REFERRAL: return 'POSITIVE_ACTION_REQUIRED';
    case CATEGORIES.NEUTRAL_QUESTION: return 'QUESTION_ACTION_REQUIRED';
    case CATEGORIES.NOT_NOW: return 'NURTURE_FUTURE';
    case CATEGORIES.OOO: return 'OOO_FOLLOWUP';
    case CATEGORIES.NEGATIVE: return 'CLOSED_NEGATIVE';
    case CATEGORIES.UNSUBSCRIBE: return 'SUPPRESSED_UNSUBSCRIBE';
    case CATEGORIES.BOUNCE_TECHNICAL: return 'SUPPRESSED_TECHNICAL';
    case CATEGORIES.AUTO_REPLY: return 'AUTOMATED_NO_ACTION';
    case CATEGORIES.INBOUND_SOLICITATION_SPAM: return 'SPAM_NO_ACTION';
    default: return 'MANUAL_REVIEW';
  }
}
function interestValue(category) {
  switch (category) {
    case CATEGORIES.PRICING_QUESTION:
    case CATEGORIES.MEETING_INTENT:
    case CATEGORIES.INTERESTED:
    case CATEGORIES.REFERRAL: return 1;
    case CATEGORIES.OOO: return 0;
    case CATEGORIES.NEGATIVE:
    case CATEGORIES.UNSUBSCRIBE: return -1;
    default: return null;
  }
}
function actionable(category) {
  return [CATEGORIES.PRICING_QUESTION, CATEGORIES.MEETING_INTENT, CATEGORIES.INTERESTED, CATEGORIES.REFERRAL, CATEGORIES.NEUTRAL_QUESTION, CATEGORIES.UNKNOWN].includes(category);
}

class InstantlyLifecycleReconciler {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.suppression = options.suppression || new GlobalSuppressionService({ rootDir: this.root });
    this.maxPages = Math.min(Math.max(Number(options.maxPages || process.env.MILES_INSTANTLY_RECONCILE_PAGES || 10), 1), 20);
    this.output = path.join(this.root, 'DATA', 'runtime', 'revenue', 'instantly_reconciliation', 'latest.json');
  }

  async listLatestReceived() {
    const items = [];
    let startingAfter = null;
    let pages = 0;
    while (pages < this.maxPages) {
      const params = { limit: 100, email_type: 'received', latest_of_thread: true, sort_order: 'desc' };
      if (startingAfter) params.starting_after = startingAfter;
      const response = await instantly.request('/emails', { method: 'GET', params });
      const batch = Array.isArray(response?.items) ? response.items : [];
      items.push(...batch);
      pages += 1;
      startingAfter = response?.next_starting_after || null;
      if (!startingAfter || !batch.length) break;
    }
    return { items, pages, truncated: Boolean(startingAfter) };
  }

  async mutateOne(email, classification) {
    const operations = [];
    const leadEmail = clean(email.lead || email.from_address_email || classification.from).toLowerCase();
    const campaignId = clean(email.campaign_id || classification.campaignId);
    const value = interestValue(classification.category);

    if (classification.hardSuppression && leadEmail) {
      operations.push({
        type: 'GLOBAL_SUPPRESSION',
        result: this.suppression.upsert({
          email: leadEmail,
          reason: classification.category,
          category: classification.category,
          source: 'INSTANTLY_LIFECYCLE_RECONCILER',
          sourceId: email.id,
          campaignId,
          evidence: classification.preview,
          hard: true
        })
      });
    }

    if (value !== null && leadEmail) {
      const body = { lead_email: leadEmail, interest_value: value };
      if (campaignId) body.campaign_id = campaignId;
      operations.push({
        type: 'CRM_INTEREST_STATUS',
        result: await instantly.request('/leads/update-interest-status', { method: 'POST', body })
      });
    }

    const patch = {};
    if (!actionable(classification.category)) patch.is_unread = 0;
    if (classification.followUpAt && [CATEGORIES.OOO, CATEGORIES.NOT_NOW].includes(classification.category)) {
      patch.reminder_ts = classification.followUpAt;
    }
    if (Object.keys(patch).length && email.id) {
      operations.push({
        type: 'UNIBOX_PATCH',
        result: await instantly.request(`/emails/${encodeURIComponent(email.id)}`, { method: 'PATCH', body: patch })
      });
    }

    if (!actionable(classification.category) && email.thread_id) {
      operations.push({
        type: 'MARK_THREAD_READ',
        result: await instantly.request(`/emails/threads/${encodeURIComponent(email.thread_id)}/mark-as-read`, { method: 'POST' })
      });
    }

    return operations;
  }

  async run(options = {}) {
    const execute = options.execute === true;
    const source = await this.listLatestReceived();
    const decisions = [];
    const errors = [];

    for (const email of source.items) {
      const classification = this.classifier.classify(email);
      const decision = {
        emailId: email.id,
        threadId: email.thread_id || null,
        lead: clean(email.lead || email.from_address_email || classification.from).toLowerCase(),
        leadId: email.lead_id || null,
        campaignId: email.campaign_id || null,
        category: classification.category,
        bucket: bucketFor(classification.category),
        interestValue: interestValue(classification.category),
        actionable: actionable(classification.category),
        followUpAt: classification.followUpAt || null,
        hardSuppression: classification.hardSuppression === true,
        operations: []
      };

      if (execute && mayMutate()) {
        try {
          decision.operations = await this.mutateOne(email, classification);
          decision.mutationExecuted = decision.operations.length > 0;
        } catch (error) {
          decision.mutationExecuted = false;
          decision.error = error.message;
          errors.push({ emailId: email.id, error: error.message });
        }
      } else {
        decision.mutationExecuted = false;
        decision.planOnly = true;
      }
      decisions.push(decision);
    }

    const counts = {};
    for (const item of decisions) counts[item.bucket] = Number(counts[item.bucket] || 0) + 1;
    const result = {
      ok: errors.length === 0,
      mode: execute && mayMutate() ? 'GOVERNED_INSTANTLY_RECONCILIATION' : 'PLAN_ONLY',
      pages: source.pages,
      truncated: source.truncated,
      inspected: decisions.length,
      buckets: counts,
      actionableRemaining: decisions.filter(x => x.actionable).length,
      nonActionableResolved: decisions.filter(x => !x.actionable).length,
      decisions,
      errors,
      safety: {
        deletesEmails: false,
        deletesLeads: false,
        hardSuppressionRecordedLocally: true,
        nonActionableThreadsMarkedRead: true,
        oooAndNotNowGetReminder: true,
        crmInterestStatusUpdatedFromReplyClassification: true,
        campaignMembershipChanged: false
      }
    };
    fs.mkdirSync(path.dirname(this.output), { recursive: true });
    fs.writeFileSync(this.output, JSON.stringify(result, null, 2), 'utf8');
    result.outputFile = this.output;
    return result;
  }
}

module.exports = InstantlyLifecycleReconciler;
module.exports.helpers = { bucketFor, interestValue, actionable, mayMutate };
