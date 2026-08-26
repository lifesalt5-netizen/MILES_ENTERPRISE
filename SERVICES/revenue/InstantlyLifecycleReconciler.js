'use strict';

const fs = require('fs');
const path = require('path');
const instantly = require('../../CONNECTORS/INSTANTLY/instantly');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const GlobalSuppressionService = require('./GlobalSuppressionService');
const CanonicalCrmService = require('../CanonicalCrmService');
const { CATEGORIES } = ReplyIntelligenceService;

function clean(v) { return String(v || '').trim(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
function lifecycleListName(bucket) {
  const names = {
    POSITIVE_ACTION_REQUIRED: 'P2GC Replies - Positive',
    QUESTION_ACTION_REQUIRED: 'P2GC Replies - Question',
    NURTURE_FUTURE: 'P2GC Replies - Nurture',
    OOO_FOLLOWUP: 'P2GC Replies - OOO',
    CLOSED_NEGATIVE: 'P2GC Replies - Closed Negative',
    SUPPRESSED_UNSUBSCRIBE: 'P2GC Replies - Unsubscribe',
    SUPPRESSED_TECHNICAL: 'P2GC Replies - Technical',
    AUTOMATED_NO_ACTION: 'P2GC Replies - Automated',
    SPAM_NO_ACTION: 'P2GC Replies - Spam',
    MANUAL_REVIEW: 'P2GC Replies - Manual Review'
  };
  return names[bucket] || names.MANUAL_REVIEW;
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
function unwrap(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.lists)) return value.lists;
  return [];
}
function listId(item) { return clean(item?.id || item?.list_id || item?.listId); }
function listName(item) { return clean(item?.name || item?.list_name || item?.title); }

class InstantlyLifecycleReconciler {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.suppression = options.suppression || new GlobalSuppressionService({ rootDir: this.root });
    this.crm = options.crm || CanonicalCrmService;
    this.maxPages = Math.min(Math.max(Number(options.maxPages || process.env.MILES_INSTANTLY_RECONCILE_PAGES || 10), 1), 20);
    this.output = path.join(this.root, 'DATA', 'runtime', 'revenue', 'instantly_reconciliation', 'latest.json');
    this.segmentLedgerPath = path.join(this.root, 'DATA', 'runtime', 'revenue', 'instantly_reconciliation', 'lifecycle_segment_ledger.json');
  }

  readSegmentLedger() {
    try {
      if (!fs.existsSync(this.segmentLedgerPath)) return { version: 1, entries: {} };
      const parsed = JSON.parse(fs.readFileSync(this.segmentLedgerPath, 'utf8').replace(/^\uFEFF/, ''));
      return parsed && typeof parsed.entries === 'object' ? parsed : { version: 1, entries: {} };
    } catch { return { version: 1, entries: {} }; }
  }

  writeSegmentLedger(ledger) {
    fs.mkdirSync(path.dirname(this.segmentLedgerPath), { recursive: true });
    ledger.version = 1;
    ledger.updatedAt = new Date().toISOString();
    const temp = `${this.segmentLedgerPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(ledger, null, 2), 'utf8');
    fs.renameSync(temp, this.segmentLedgerPath);
  }

  segmentKey(email, campaignId, bucket) { return `${clean(email).toLowerCase()}|${clean(campaignId)}|${clean(bucket)}`; }

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

  async listLeadLists() {
    const all = [];
    let startingAfter = null;
    for (let page = 0; page < 20; page += 1) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;
      const response = await instantly.request('/lead-lists', { method: 'GET', params });
      const batch = unwrap(response);
      all.push(...batch);
      startingAfter = response?.next_starting_after || response?.nextStartingAfter || null;
      if (!startingAfter || !batch.length) break;
    }
    return all;
  }

  async ensureLifecycleLists(requiredBuckets) {
    const existing = await this.listLeadLists();
    const byName = new Map(existing.map(item => [listName(item).toLowerCase(), item]));
    const result = {};
    for (const bucket of requiredBuckets) {
      const name = lifecycleListName(bucket);
      let item = byName.get(name.toLowerCase());
      if (!item) {
        const created = await instantly.request('/lead-lists', { method: 'POST', body: { name } });
        item = created?.item || created?.data || created;
        if (!listId(item)) {
          const refreshed = await this.listLeadLists();
          item = refreshed.find(x => listName(x).toLowerCase() === name.toLowerCase()) || item;
        }
        byName.set(name.toLowerCase(), item);
      }
      const id = listId(item);
      if (!id) throw new Error(`Unable to resolve Instantly lead list id for ${name}`);
      result[bucket] = { id, name };
    }
    return result;
  }

  async pollBackgroundJob(response) {
    const jobId = clean(response?.id || response?.job_id || response?.jobId || response?.background_job_id || response?.backgroundJobId);
    if (!jobId) return { accepted: true, jobId: null, final: response };
    let last = response;
    for (let i = 0; i < 20; i += 1) {
      await sleep(1000);
      try { last = await instantly.request(`/background-jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }); }
      catch { return { accepted: true, jobId, final: response, pollStatus: 'POLL_UNAVAILABLE' }; }
      const status = clean(last?.status || last?.state || last?.job_status).toLowerCase();
      if (/complete|completed|success|succeeded|done/.test(status)) return { accepted: true, jobId, final: last, pollStatus: status };
      if (/fail|failed|error|cancel/.test(status)) throw new Error(`Instantly lifecycle move job ${jobId} failed: ${JSON.stringify(last).slice(0,1000)}`);
    }
    return { accepted: true, jobId, final: last, pollStatus: 'SUBMITTED_PENDING' };
  }

  reconcileCanonicalCrm(email, classification, bucket, lifecycleList, leadEmail, campaignId) {
    if (!leadEmail) return null;
    const upsert = this.crm.upsertIdentity({
      email: leadEmail,
      campaignId,
      replyCategory: classification.category,
      replyLifecycleSegment: lifecycleList?.name || lifecycleListName(bucket),
      replyFollowUpAt: classification.followUpAt || '',
      lastReplyAt: classification.timestamp || new Date().toISOString(),
      source: 'INSTANTLY_REPLY_LIFECYCLE'
    }, { source: 'INSTANTLY_LIFECYCLE_RECONCILER' });

    let stage = null;
    if ([CATEGORIES.PRICING_QUESTION, CATEGORIES.MEETING_INTENT, CATEGORIES.INTERESTED, CATEGORIES.REFERRAL].includes(classification.category)) {
      stage = this.crm.advanceStageAtLeast({ email: leadEmail }, 'Qualified', {
        type: 'QUALIFIED_HUMAN_REPLY', source: 'INSTANTLY_LIFECYCLE_RECONCILER', category: classification.category, campaignId, sourceEmailId: email.id || null
      });
    } else if ([CATEGORIES.NEUTRAL_QUESTION, CATEGORIES.UNKNOWN, CATEGORIES.NOT_NOW].includes(classification.category)) {
      stage = this.crm.advanceStageAtLeast({ email: leadEmail }, 'Engaged', {
        type: 'HUMAN_REPLY_ENGAGEMENT', source: 'INSTANTLY_LIFECYCLE_RECONCILER', category: classification.category, campaignId, sourceEmailId: email.id || null
      });
    }
    return { upsert, stage };
  }

  async moveToLifecycleList(email, classification, bucket, lifecycleList, ledger) {
    const leadEmail = clean(email.lead || email.from_address_email || classification.from).toLowerCase();
    const campaignId = clean(email.campaign_id || classification.campaignId);
    if (!leadEmail || !campaignId || !lifecycleList?.id) return { skipped: true, reason: 'MISSING_LEAD_CAMPAIGN_OR_DESTINATION' };

    const key = this.segmentKey(leadEmail, campaignId, bucket);
    if (ledger.entries[key]?.accepted === true) return { skipped: true, reason: 'LIFECYCLE_MOVE_ALREADY_RECORDED', prior: ledger.entries[key] };

    const body = {
      campaign: campaignId,
      contacts: [leadEmail],
      to_list_id: lifecycleList.id,
      copy_leads: false,
      reset_interest_status: false
    };
    const submitted = await instantly.request('/leads/move', { method: 'POST', body });
    const job = await this.pollBackgroundJob(submitted);
    ledger.entries[key] = {
      email: leadEmail,
      sourceCampaignId: campaignId,
      bucket,
      destinationListId: lifecycleList.id,
      destinationListName: lifecycleList.name,
      accepted: true,
      recordedAt: new Date().toISOString(),
      jobId: job.jobId || null,
      pollStatus: job.pollStatus || null
    };
    this.writeSegmentLedger(ledger);
    return { skipped: false, request: body, submitted, job };
  }

  async mutateOne(email, classification, lifecycleList, ledger) {
    const operations = [];
    const leadEmail = clean(email.lead || email.from_address_email || classification.from).toLowerCase();
    const campaignId = clean(email.campaign_id || classification.campaignId);
    const bucket = bucketFor(classification.category);
    const value = interestValue(classification.category);

    if (classification.hardSuppression && leadEmail) {
      operations.push({ type: 'GLOBAL_SUPPRESSION', result: this.suppression.upsert({
        email: leadEmail, reason: classification.category, category: classification.category,
        source: 'INSTANTLY_LIFECYCLE_RECONCILER', sourceId: email.id, campaignId,
        evidence: classification.preview, hard: true
      }) });
    }

    if (value !== null && leadEmail) {
      const body = { lead_email: leadEmail, interest_value: value };
      if (campaignId) body.campaign_id = campaignId;
      operations.push({ type: 'CRM_INTEREST_STATUS', result: await instantly.request('/leads/update-interest-status', { method: 'POST', body }) });
    }

    const patch = {};
    if (!actionable(classification.category)) patch.is_unread = 0;
    if (classification.followUpAt && [CATEGORIES.OOO, CATEGORIES.NOT_NOW].includes(classification.category)) patch.reminder_ts = classification.followUpAt;
    if (Object.keys(patch).length && email.id) operations.push({ type: 'UNIBOX_PATCH', result: await instantly.request(`/emails/${encodeURIComponent(email.id)}`, { method: 'PATCH', body: patch }) });
    if (!actionable(classification.category) && email.thread_id) operations.push({ type: 'MARK_THREAD_READ', result: await instantly.request(`/emails/threads/${encodeURIComponent(email.thread_id)}/mark-as-read`, { method: 'POST' }) });

    operations.push({ type: 'CANONICAL_CRM_LIFECYCLE', result: this.reconcileCanonicalCrm(email, classification, bucket, lifecycleList, leadEmail, campaignId) });
    operations.push({ type: 'MOVE_TO_REPLY_LIFECYCLE_SEGMENT', result: await this.moveToLifecycleList(email, classification, bucket, lifecycleList, ledger) });
    return operations;
  }

  async run(options = {}) {
    const execute = options.execute === true;
    const source = await this.listLatestReceived();
    const decisions = [];
    const errors = [];
    const classified = source.items.map(email => ({ email, classification: this.classifier.classify(email) }));
    const requiredBuckets = [...new Set(classified.map(x => bucketFor(x.classification.category)))];
    const lifecycleLists = execute && mayMutate() ? await this.ensureLifecycleLists(requiredBuckets) : Object.fromEntries(requiredBuckets.map(bucket => [bucket, { id: null, name: lifecycleListName(bucket) }]));
    const ledger = this.readSegmentLedger();

    for (const { email, classification } of classified) {
      const bucket = bucketFor(classification.category);
      const decision = {
        emailId: email.id, threadId: email.thread_id || null,
        lead: clean(email.lead || email.from_address_email || classification.from).toLowerCase(),
        leadId: email.lead_id || null, campaignId: email.campaign_id || null,
        category: classification.category, bucket,
        lifecycleList: lifecycleLists[bucket] || null,
        interestValue: interestValue(classification.category), actionable: actionable(classification.category),
        followUpAt: classification.followUpAt || null, hardSuppression: classification.hardSuppression === true,
        operations: []
      };
      if (execute && mayMutate()) {
        try {
          decision.operations = await this.mutateOne(email, classification, lifecycleLists[bucket], ledger);
          decision.mutationExecuted = decision.operations.some(op => op?.result?.skipped !== true);
        } catch (error) {
          decision.mutationExecuted = false;
          decision.error = error.message;
          errors.push({ emailId: email.id, error: error.message });
        }
      } else { decision.mutationExecuted = false; decision.planOnly = true; }
      decisions.push(decision);
    }

    const counts = {};
    for (const item of decisions) counts[item.bucket] = Number(counts[item.bucket] || 0) + 1;
    const result = {
      ok: errors.length === 0,
      mode: execute && mayMutate() ? 'GOVERNED_INSTANTLY_RECONCILIATION_WITH_REPLY_SEGMENT_MOVE' : 'PLAN_ONLY',
      pages: source.pages, truncated: source.truncated, inspected: decisions.length,
      buckets: counts, lifecycleLists,
      actionableRemaining: decisions.filter(x => x.actionable).length,
      nonActionableResolved: decisions.filter(x => !x.actionable).length,
      lifecycleSegmentMovesAccepted: decisions.reduce((n, d) => n + d.operations.filter(op => op.type === 'MOVE_TO_REPLY_LIFECYCLE_SEGMENT' && op.result?.skipped !== true).length, 0),
      lifecycleSegmentMovesSkippedAlreadyRecorded: decisions.reduce((n, d) => n + d.operations.filter(op => op.type === 'MOVE_TO_REPLY_LIFECYCLE_SEGMENT' && op.result?.reason === 'LIFECYCLE_MOVE_ALREADY_RECORDED').length, 0),
      decisions, errors,
      safety: {
        deletesEmails: false,
        deletesLeads: false,
        hardSuppressionRecordedLocally: true,
        nonActionableThreadsMarkedRead: true,
        oooAndNotNowGetReminder: true,
        crmInterestStatusUpdatedFromReplyClassification: true,
        canonicalCrmLifecycleSegmentUpdated: true,
        campaignMembershipChangedForRepliedLeadsOnly: true,
        sourceCampaignLeadRemovedAfterReply: true,
        resetInterestStatusOnMove: false
      }
    };
    fs.mkdirSync(path.dirname(this.output), { recursive: true });
    fs.writeFileSync(this.output, JSON.stringify(result, null, 2), 'utf8');
    result.outputFile = this.output;
    return result;
  }
}

module.exports = InstantlyLifecycleReconciler;
module.exports.helpers = { bucketFor, lifecycleListName, interestValue, actionable, mayMutate, unwrap };
