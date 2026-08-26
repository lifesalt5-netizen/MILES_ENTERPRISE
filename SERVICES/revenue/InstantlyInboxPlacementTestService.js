'use strict';

function clean(v) { return String(v || '').trim(); }
function lower(v) { return clean(v).toLowerCase(); }
function unwrap(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.items)) return v.items;
  if (Array.isArray(v?.data)) return v.data;
  if (Array.isArray(v?.accounts)) return v.accounts;
  return [];
}
function accountEmail(a = {}) { return lower(a.email || a.address || a.account || a.username); }
function isActiveAccount(a = {}) { return Number(a.status) === 1 || lower(a.status) === 'active'; }
function testLimit(a = {}) {
  const n = Number(a.inbox_placement_test_limit);
  return Number.isFinite(n) ? n : null;
}
function labelKey(x = {}) { return [x.region, x.sub_region, x.type, x.esp].map(clean).join('|'); }
function timestampToken(date) { return date.toISOString().replace(/[:.]/g, '-'); }

class InstantlyInboxPlacementTestService {
  constructor(options = {}) {
    if (!options.client || typeof options.client.request !== 'function') throw new Error('Instantly client with request() is required.');
    this.client = options.client;
    this.now = options.now || (() => new Date());
  }

  async listPaged(endpoint, params = {}) {
    const rows = [];
    let startingAfter = null;
    for (let page = 0; page < 20; page += 1) {
      const p = { limit: 100, ...params };
      if (startingAfter) p.starting_after = startingAfter;
      const response = await this.client.request(endpoint, { method: 'GET', params: p });
      const batch = unwrap(response);
      rows.push(...batch);
      startingAfter = response?.next_starting_after || null;
      if (!startingAfter || batch.length === 0) break;
    }
    return rows;
  }

  async buildPlan(options = {}) {
    const forceNew = options.forceNew === true;
    const [accounts, providerOptions, tests] = await Promise.all([
      this.listPaged('/accounts'),
      this.listPaged('/inbox-placement-tests/email-service-provider-options'),
      this.listPaged('/inbox-placement-tests')
    ]);

    const active = accounts.filter(isActiveAccount).filter(a => accountEmail(a));
    const eligible = active.filter(a => testLimit(a) === null || testLimit(a) > 0);
    const zeroLimit = active.filter(a => testLimit(a) === 0);

    const desired = providerOptions.filter(o => {
      const region = lower(o.region);
      const esp = lower(o.esp || o.provider || o.email_service_provider);
      return region.includes('north america') && (esp.includes('google') || esp.includes('gmail') || esp.includes('microsoft') || esp.includes('outlook'));
    });

    const providerLabels = [...new Map(desired.map(x => [labelKey(x), {
      region: x.region,
      sub_region: x.sub_region,
      type: x.type,
      esp: x.esp
    }])).values()];

    const now = this.now();
    const date = now.toISOString().slice(0, 10);
    const baseName = `P2GC Baseline Inbox Placement ${date}`;
    const name = forceNew ? `${baseName} POST-DMARC ${timestampToken(now)}` : baseName;
    const existing = forceNew ? null : (tests.find(t => clean(t.name) === name) || null);

    const blockers = [];
    if (eligible.length === 0) blockers.push('NO_ACTIVE_SENDER_WITH_INBOX_PLACEMENT_CAPACITY');
    if (providerLabels.length === 0) blockers.push('NO_GOOGLE_OR_MICROSOFT_NORTH_AMERICA_PROVIDER_OPTIONS');

    return {
      name,
      forceNew,
      activeAccounts: active.map(a => ({ email: accountEmail(a), status: a.status, inboxPlacementTestLimit: testLimit(a) })),
      eligibleSenders: eligible.map(accountEmail),
      zeroLimitSenders: zeroLimit.map(accountEmail),
      providerLabels,
      existingTest: existing,
      blockers,
      ready: blockers.length === 0
    };
  }

  async createControlledBaseline(options = {}) {
    const plan = await this.buildPlan(options);
    if (plan.existingTest) return { ok: true, created: false, reused: true, plan, test: plan.existingTest };
    if (!plan.ready) return { ok: false, created: false, plan, status: 'BLOCKED' };

    const payload = {
      name: plan.name,
      description: plan.forceNew
        ? 'P2GC controlled post-DMARC verification: sender infrastructure and plain-text content. No prospects or campaign leads are used.'
        : 'P2GC controlled one-time baseline: sender infrastructure and plain-text content. No prospects or campaign leads are used.',
      type: 1,
      sending_method: 1,
      delivery_mode: 1,
      text_only: true,
      email_subject: 'Government contracting question',
      email_body: 'Hi,\n\nI wanted to reach out with a quick government contracting question.\n\nKevin\nPathways 2 Government Contracting',
      emails: plan.eligibleSenders,
      recipients_labels: plan.providerLabels
    };

    const created = await this.client.request('/inbox-placement-tests', { method: 'POST', body: payload, retries: 0 });
    const id = clean(created?.id || created?.data?.id);
    if (!id) return { ok: false, created: false, plan, payload, providerResult: created, status: 'CREATE_RETURNED_NO_TEST_ID' };

    const readback = await this.client.request(`/inbox-placement-tests/${encodeURIComponent(id)}`, { method: 'GET', params: { with_metadata: true } });
    return {
      ok: true,
      created: true,
      reused: false,
      plan,
      payload,
      test: readback,
      testId: id,
      externalReadbackVerified: clean(readback?.id) === id
    };
  }
}

module.exports = { InstantlyInboxPlacementTestService, isActiveAccount, testLimit, timestampToken };
