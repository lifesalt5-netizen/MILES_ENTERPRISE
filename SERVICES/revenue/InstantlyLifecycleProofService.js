'use strict';

const fs = require('fs');
const path = require('path');
const instantly = require('../../CONNECTORS/INSTANTLY/instantly');
const InstantlyLifecycleReconciler = require('./InstantlyLifecycleReconciler');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const { bucketFor, lifecycleListName, interestValue, mayMutate } = InstantlyLifecycleReconciler.helpers;

function clean(v) { return String(v || '').trim(); }
function unwrap(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.leads)) return value.leads;
  return [];
}
function leadEmail(lead = {}) { return clean(lead.email || lead.contact).toLowerCase(); }
function listId(item = {}) { return clean(item.id || item.list_id || item.listId); }
function listName(item = {}) { return clean(item.name || item.list_name || item.title); }

class InstantlyLifecycleProofService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.reconciler = options.reconciler || new InstantlyLifecycleReconciler({ root: this.root });
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.output = path.join(this.root, 'DATA', 'runtime', 'revenue', 'instantly_lifecycle_proof', 'latest.json');
  }

  async exactMembership(email, destination) {
    if (!email || !destination?.id) return { verified: false, reason: 'MISSING_EMAIL_OR_DESTINATION' };
    const response = await instantly.listLeads({
      list_id: destination.id,
      search: email,
      in_list: true,
      limit: 100,
      distinct_contacts: true
    });
    const leads = unwrap(response);
    const exact = leads.find(item => leadEmail(item) === email.toLowerCase()) || null;
    return {
      verified: Boolean(exact),
      lead: exact,
      observedListId: clean(exact?.list_id),
      destinationListId: destination.id,
      destinationListName: destination.name,
      providerResultCount: leads.length
    };
  }

  interestVerified(classification, membership) {
    const expected = interestValue(classification.category);
    if (expected === null) return { applicable: false, verified: true, expected: null, observed: membership?.lead?.lt_interest_status ?? null };
    const observed = membership?.lead?.lt_interest_status;
    return { applicable: true, verified: Number(observed) === Number(expected), expected, observed: observed ?? null };
  }

  async resolveExistingLifecycleLists(buckets) {
    const existing = await this.reconciler.listLeadLists();
    const byName = new Map(existing.map(item => [listName(item).toLowerCase(), item]));
    const result = {};
    for (const bucket of buckets) {
      const name = lifecycleListName(bucket);
      const item = byName.get(name.toLowerCase()) || null;
      result[bucket] = item ? { id: listId(item), name } : { id: null, name, missing: true };
    }
    return result;
  }

  async repairOne(emailRecord, classification, bucket, destination) {
    const email = clean(emailRecord.lead || emailRecord.from_address_email || classification.from).toLowerCase();
    const campaignId = clean(emailRecord.campaign_id || classification.campaignId);
    const ledger = this.reconciler.readSegmentLedger();
    const key = this.reconciler.segmentKey(email, campaignId, bucket);
    if (ledger.entries[key]) {
      delete ledger.entries[key];
      this.reconciler.writeSegmentLedger(ledger);
    }
    return this.reconciler.mutateOne(emailRecord, classification, destination, ledger);
  }

  async run(options = {}) {
    const execute = options.execute === true;
    const source = await this.reconciler.listLatestReceived();
    const classified = source.items.map(emailRecord => ({ emailRecord, classification: this.classifier.classify(emailRecord) }));
    const buckets = [...new Set(classified.map(x => bucketFor(x.classification.category)))];
    const destinations = execute && mayMutate()
      ? await this.reconciler.ensureLifecycleLists(buckets)
      : await this.resolveExistingLifecycleLists(buckets);

    const decisions = [];
    const errors = [];
    for (const item of classified) {
      const bucket = bucketFor(item.classification.category);
      const destination = destinations[bucket] || { id: null, name: lifecycleListName(bucket), missing: true };
      const email = clean(item.emailRecord.lead || item.emailRecord.from_address_email || item.classification.from).toLowerCase();
      let before;
      try { before = await this.exactMembership(email, destination); }
      catch (error) { before = { verified: false, reason: 'PROVIDER_READ_FAILED', error: error.message }; }
      const interestBefore = this.interestVerified(item.classification, before);
      const correctBefore = before.verified === true && interestBefore.verified === true;
      let operations = [];
      let after = before;
      let interestAfter = interestBefore;
      let repaired = false;

      if (execute && mayMutate() && !correctBefore) {
        try {
          operations = await this.repairOne(item.emailRecord, item.classification, bucket, destination);
          repaired = true;
          after = await this.exactMembership(email, destination);
          interestAfter = this.interestVerified(item.classification, after);
        } catch (error) {
          errors.push({ emailId: item.emailRecord.id || null, lead: email, bucket, error: error.message });
          after = { verified: false, reason: 'REPAIR_OR_POST_READ_FAILED', error: error.message };
          interestAfter = { applicable: interestBefore.applicable, verified: false, expected: interestBefore.expected, observed: null };
        }
      }

      const verified = after.verified === true && interestAfter.verified === true;
      decisions.push({
        emailId: item.emailRecord.id || null,
        threadId: item.emailRecord.thread_id || null,
        lead: email,
        campaignId: item.emailRecord.campaign_id || null,
        category: item.classification.category,
        bucket,
        destination,
        before: { membership: before, interest: interestBefore, verified: correctBefore },
        repairAttempted: repaired,
        operations,
        after: { membership: after, interest: interestAfter, verified }
      });
    }

    const mismatches = decisions.filter(x => !x.after.verified);
    const result = {
      ok: errors.length === 0 && mismatches.length === 0,
      mode: execute && mayMutate() ? 'PROVIDER_BACKED_REPAIR_AND_POST_VERIFY' : 'READ_ONLY_PROVIDER_PROOF',
      inspected: decisions.length,
      pages: source.pages,
      truncated: source.truncated,
      providerVerifiedCorrect: decisions.filter(x => x.after.verified).length,
      providerMismatches: mismatches.length,
      repaired: decisions.filter(x => x.repairAttempted && x.after.verified).length,
      destinations,
      decisions,
      errors,
      safety: {
        sendsMessages: false,
        deletesEmails: false,
        deletesLeads: false,
        localLedgerCannotOverrideProviderMismatch: true,
        postMutationProviderReadRequired: true
      }
    };
    fs.mkdirSync(path.dirname(this.output), { recursive: true });
    fs.writeFileSync(this.output, JSON.stringify(result, null, 2), 'utf8');
    result.outputFile = this.output;
    return result;
  }
}

module.exports = InstantlyLifecycleProofService;
module.exports.helpers = { unwrap, leadEmail };
