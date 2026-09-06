'use strict';

const P2GCMarketingPolicy = require('./P2GCMarketingSalesOperatingPolicy');

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function csv(value) { return clean(value).split(',').map(x => x.trim().toLowerCase()).filter(Boolean); }
function emailOf(account = {}) {
  return lower(account.email || account.account_email || account.email_address || account.address || account.username || account.account || '');
}
function statusText(account = {}) {
  return lower([account.status, account.state, account.provider_status, account.connection_status, account.health_status].filter(v => v !== undefined && v !== null).join(' '));
}
function explicitlyUnusable(account = {}) {
  const email = emailOf(account);
  if (!email) return true;
  if (P2GCMarketingPolicy.isProtectedDomain(email)) return true;
  if (account.active === false || account.enabled === false || account.is_enabled === false || account.connected === false || account.is_connected === false) return true;
  return /(disabled|disconnected|deleted|removed|failed|error|invalid|expired|revoked|suspended|blocked|not.?found)/i.test(statusText(account));
}
function unwrapAccounts(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.accounts)) return value.accounts;
  return [];
}
function domain(email) { const at = lower(email).lastIndexOf('@'); return at >= 0 ? lower(email).slice(at + 1) : ''; }

function resolveSender({ requestedSender = '', inventory = [], approvedFallbacks = [], primaryFallback = '', allowSameDomain = true, excluded = [] } = {}) {
  const requested = lower(requestedSender);
  const blocked = new Set((excluded || []).map(lower));
  const rows = unwrapAccounts(inventory).map(account => ({ account, email: emailOf(account), usable: !explicitlyUnusable(account) })).filter(x => x.email);
  const byEmail = new Map(rows.map(row => [row.email, row]));
  const requestedRow = requested ? byEmail.get(requested) : null;

  if (P2GCMarketingPolicy.isProtectedDomain(requested)) {
    blocked.add(requested);
  }

  if (requestedRow?.usable && !blocked.has(requested)) {
    return { ok: true, selected: requested, requested, failover: false, reason: 'REQUESTED_SENDER_AVAILABLE', inventoryCount: rows.length };
  }

  const ordered = [];
  const push = value => {
    const e = lower(value);
    if (!e || P2GCMarketingPolicy.isProtectedDomain(e)) return;
    if (!ordered.includes(e)) ordered.push(e);
  };
  (approvedFallbacks || []).forEach(push);
  push(primaryFallback);

  if (allowSameDomain && requested && !P2GCMarketingPolicy.isProtectedDomain(requested)) {
    const wantedDomain = domain(requested);
    rows.filter(row => row.usable && domain(row.email) === wantedDomain).forEach(row => push(row.email));
  }

  for (const candidate of ordered) {
    if (blocked.has(candidate) || P2GCMarketingPolicy.isProtectedDomain(candidate)) continue;
    const row = byEmail.get(candidate);
    if (row?.usable) {
      return {
        ok: true,
        selected: candidate,
        requested,
        failover: candidate !== requested,
        reason: requested ? 'REQUESTED_SENDER_UNAVAILABLE_FALLBACK_SELECTED' : 'FALLBACK_SELECTED',
        inventoryCount: rows.length,
        protectedPrimaryDomainFailover: false
      };
    }
  }

  return {
    ok: false,
    selected: '',
    requested,
    failover: false,
    reason: P2GCMarketingPolicy.isProtectedDomain(requested)
      ? 'PROTECTED_PRIMARY_DOMAIN_BLOCKED_NO_SAFE_SECONDARY_FALLBACK'
      : (requested ? 'REQUESTED_SENDER_UNAVAILABLE_NO_SAFE_FALLBACK' : 'NO_SAFE_REPLY_SENDER'),
    status: 'SEND_ACCOUNT_BLOCKED',
    inventoryCount: rows.length,
    protectedPrimaryDomainFailover: false,
    usableSenders: rows.filter(row => row.usable).map(row => row.email)
  };
}

function fromEnvironment() {
  return {
    approvedFallbacks: csv(process.env.MILES_INSTANTLY_REPLY_FALLBACKS || ''),
    primaryFallback: lower(process.env.MILES_PRIMARY_REPLY_SENDER || ''),
    allowSameDomain: !['0', 'false', 'no', 'off'].includes(lower(process.env.MILES_ALLOW_SAME_DOMAIN_REPLY_FAILOVER || 'true'))
  };
}

module.exports = {
  emailOf,
  explicitlyUnusable,
  unwrapAccounts,
  resolveSender,
  fromEnvironment
};
