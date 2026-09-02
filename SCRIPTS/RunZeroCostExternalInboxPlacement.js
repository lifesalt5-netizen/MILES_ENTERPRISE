'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
process.env.MILES_ROOT = ROOT;
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), override: false, quiet: true });

const instantly = require(path.join(ROOT, 'CONNECTORS', 'INSTANTLY', 'instantly.js'));
const { ZERO_COST_TARGET_MAILBOXES } = require(path.join(ROOT, 'SCRIPTS', 'AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js'));

const REQUIRED_AUTHORIZATION = 'AUTHORIZE_ZERO_COST_EXTERNAL_PLACEMENT_TESTS';
const TEST_RECIPIENT = 'find@myips.io';
const SOURCE = 'INBOXY_FREE_EXTERNAL_INBOX_PLACEMENT';
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'runtime', 'revenue', 'deliverability');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'external_inbox_placement_latest.json');
const INITIAL_SEND_GAP_MS = Number(process.env.MILES_EXTERNAL_PLACEMENT_SEND_GAP_MS || 7000);
const POLL_MS = Number(process.env.MILES_EXTERNAL_PLACEMENT_POLL_MS || 10000);
const FIRST_REPLY_TIMEOUT_MS = Number(process.env.MILES_EXTERNAL_PLACEMENT_FIRST_REPLY_TIMEOUT_MS || 180000);
const FINAL_REPLY_TIMEOUT_MS = Number(process.env.MILES_EXTERNAL_PLACEMENT_FINAL_REPLY_TIMEOUT_MS || 180000);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : '';
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').trim().toLowerCase(); }
function unwrap(v) { return Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : Array.isArray(v?.data) ? v.data : []; }
function stripHtml(v) { return String(v || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function bodyText(email = {}) { return [email?.subject, email?.body?.text, stripHtml(email?.body?.html), email?.content_preview].filter(Boolean).join('\n'); }
function timestampMs(email = {}) { return Date.parse(email?.timestamp_created || email?.timestamp_email || '') || 0; }
function fromMyIps(email = {}) { return clean(email?.from_address_email).endsWith('@myips.io'); }
function exactAccount(email = {}, account) { return clean(email?.eaccount) === clean(account) || clean(email?.to_address_email_list).split(',').map(clean).includes(clean(account)); }

function parsePercentNear(text, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escaped}[^0-9]{0,30}(\\d{1,3}(?:\\.\\d+)?)\\s*%`, 'i'),
    new RegExp(`(\\d{1,3}(?:\\.\\d+)?)\\s*%[^\\n]{0,30}${escaped}`, 'i')
  ];
  for (const p of patterns) {
    const m = String(text || '').match(p);
    if (m) return Number(m[1]);
  }
  return null;
}

function parsePass(text, name) {
  const t = String(text || '');
  const p1 = new RegExp(`${name}[^\\n]{0,40}(pass|passed|valid|aligned|success)`, 'i');
  const p2 = new RegExp(`(pass|passed|valid|aligned|success)[^\\n]{0,40}${name}`, 'i');
  const fail = new RegExp(`${name}[^\\n]{0,40}(fail|failed|invalid|unaligned|error)`, 'i');
  if (fail.test(t)) return false;
  if (p1.test(t) || p2.test(t)) return true;
  return null;
}

function providerEvidence(text) {
  const t = String(text || '').toLowerCase();
  const providers = [
    ['gmail', /\bgmail\b/],
    ['google_workspace', /google workspace|workspace gmail/],
    ['outlook', /\boutlook\b|hotmail/],
    ['microsoft_365', /microsoft 365|office 365|o365/]
  ];
  return providers.filter(([, re]) => re.test(t)).map(([name]) => name);
}

function classifyReport(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const lower = normalized.toLowerCase();
  const inboxPct = parsePercentNear(normalized, 'inbox placement') ?? parsePercentNear(normalized, 'inbox');
  const spamPct = parsePercentNear(normalized, 'spam');
  const spfPass = parsePass(normalized, 'spf');
  const dkimPass = parsePass(normalized, 'dkim');
  const dmarcPass = parsePass(normalized, 'dmarc');
  const providers = providerEvidence(normalized);
  const hasPlacementLanguage = /inbox placement|primary inbox|spam folder|promotions/.test(lower);
  const authProven = spfPass === true && dkimPass === true && dmarcPass === true;
  const placementProven = hasPlacementLanguage && inboxPct !== null && providers.length >= 2;
  const active = placementProven && inboxPct >= 80 && (spamPct === null || spamPct === 0) && authProven;
  return {
    inboxPct,
    spamPct,
    spfPass,
    dkimPass,
    dmarcPass,
    providers,
    placementProven,
    authProven,
    status: active ? 'ACTIVE' : placementProven ? 'WATCH' : 'UNVERIFIED'
  };
}

async function listIncomingFor(account, minIso) {
  const response = await instantly.request('/emails', {
    method: 'GET',
    params: {
      limit: 100,
      eaccount: account,
      email_type: 'received',
      min_timestamp_created: minIso,
      sort_order: 'desc'
    },
    retries: 1
  });
  return unwrap(response).filter(email => fromMyIps(email) && exactAccount(email, account));
}

async function waitForIncoming(account, minIso, excludeIds = new Set(), timeoutMs = FIRST_REPLY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await listIncomingFor(account, minIso);
    const found = rows.find(row => row?.id && !excludeIds.has(String(row.id)));
    if (found) return found;
    await sleep(POLL_MS);
  }
  return null;
}

async function sendInitial(account) {
  return instantly.request('/emails/test', {
    method: 'POST',
    body: {
      eaccount: account,
      to_address_email_list: TEST_RECIPIENT,
      subject: ' ',
      body: { text: ' ' }
    },
    retries: 0
  });
}

async function sendReply(account, incoming) {
  return instantly.request('/emails/reply', {
    method: 'POST',
    body: {
      eaccount: account,
      reply_to_uuid: incoming.id,
      subject: String(incoming?.subject || 'Re:').startsWith('Re:') ? String(incoming?.subject || 'Re:') : `Re: ${String(incoming?.subject || '')}`,
      body: { text: ' ' }
    },
    retries: 0
  });
}

async function testOne(account) {
  const startedAt = new Date().toISOString();
  const result = {
    sender: account,
    source: SOURCE,
    testRecipient: TEST_RECIPIENT,
    initialTestSent: false,
    challengeReceived: false,
    challengeReplied: false,
    finalReportReceived: false,
    status: 'UNVERIFIED',
    startedAt
  };
  try {
    await sendInitial(account);
    result.initialTestSent = true;
    const challenge = await waitForIncoming(account, startedAt, new Set(), FIRST_REPLY_TIMEOUT_MS);
    if (!challenge) return { ...result, blocker: 'INBOXY_INITIAL_REPLY_TIMEOUT' };
    result.challengeReceived = true;
    result.challengeEmailId = challenge.id;

    const repliedAt = new Date().toISOString();
    await sendReply(account, challenge);
    result.challengeReplied = true;
    result.repliedAt = repliedAt;

    const final = await waitForIncoming(account, repliedAt, new Set([String(challenge.id)]), FINAL_REPLY_TIMEOUT_MS);
    if (!final) return { ...result, blocker: 'INBOXY_FINAL_REPORT_TIMEOUT' };
    result.finalReportReceived = true;
    result.finalEmailId = final.id;
    const text = bodyText(final);
    const parsed = classifyReport(text);
    return {
      ...result,
      ...parsed,
      reportExcerpt: text.slice(0, 5000),
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    return { ...result, blocker: 'EXTERNAL_PLACEMENT_PROVIDER_OR_EMAIL_API_ERROR', error: String(error?.message || error), completedAt: new Date().toISOString() };
  }
}

function writeEvidence(value) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(value, null, 2), 'utf8');
}

async function execute(authorization) {
  if (String(authorization || '').trim() !== REQUIRED_AUTHORIZATION) throw new Error('EXACT_EXTERNAL_PLACEMENT_AUTHORIZATION_REQUIRED');
  const results = [];
  for (let i = 0; i < ZERO_COST_TARGET_MAILBOXES.length; i += 1) {
    const account = ZERO_COST_TARGET_MAILBOXES[i];
    results.push(await testOne(account));
    if (i < ZERO_COST_TARGET_MAILBOXES.length - 1) await sleep(INITIAL_SEND_GAP_MS);
  }
  const senders = results.map(r => ({
    sender: r.sender,
    samples: r.finalReportReceived ? 1 : 0,
    inboxPct: r.inboxPct,
    spamPct: r.spamPct,
    spfPassPct: r.spfPass === true ? 100 : r.spfPass === false ? 0 : null,
    dkimPassPct: r.dkimPass === true ? 100 : r.dkimPass === false ? 0 : null,
    dmarcPassPct: r.dmarcPass === true ? 100 : r.dmarcPass === false ? 0 : null,
    providers: r.providers || [],
    latestAt: r.completedAt || null,
    status: r.status,
    blocker: r.blocker || null
  }));
  const active = senders.filter(s => s.status === 'ACTIVE');
  const result = {
    ok: active.length === ZERO_COST_TARGET_MAILBOXES.length,
    status: active.length === ZERO_COST_TARGET_MAILBOXES.length ? 'ZERO_COST_EXTERNAL_PLACEMENT_FULL_GO' : 'ZERO_COST_EXTERNAL_PLACEMENT_NOT_FULL_GO',
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    sourceUrl: 'https://inboxy.io/inbox-placement-test/',
    testRecipient: TEST_RECIPIENT,
    targetIndependentPaidMailboxes: ZERO_COST_TARGET_MAILBOXES.length,
    activeCount: active.length,
    senders,
    details: results,
    safety: {
      fixedExternalTestRecipientOnly: true,
      prospectSend: false,
      campaignsMutated: false,
      dnsMutated: false,
      googleWorkspaceMutated: false,
      newWorkspaceLicensesPurchased: false,
      recurringWorkspaceCostChanged: false,
      protectedPrimaryDomainExcluded: ZERO_COST_TARGET_MAILBOXES.every(e => !e.endsWith('@pathways2gc.com'))
    }
  };
  writeEvidence(result);
  return result;
}

async function main() {
  const authorization = argValue('--authorization') || process.env.MILES_EXTERNAL_PLACEMENT_AUTHORIZATION || '';
  const result = await execute(authorization);
  console.log('ZERO_COST_EXTERNAL_INBOX_PLACEMENT');
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    const result = {
      ok: false,
      status: 'ZERO_COST_EXTERNAL_PLACEMENT_FAILED',
      error: String(error?.message || error),
      generatedAt: new Date().toISOString(),
      safety: {
        fixedExternalTestRecipientOnly: true,
        prospectSend: false,
        campaignsMutated: false,
        dnsMutated: false,
        googleWorkspaceMutated: false,
        newWorkspaceLicensesPurchased: false,
        recurringWorkspaceCostChanged: false
      }
    };
    try { writeEvidence(result); } catch {}
    console.error('ZERO_COST_EXTERNAL_PLACEMENT_FAILED');
    console.error(result.error);
    process.exitCode = 2;
  });
}

module.exports = {
  REQUIRED_AUTHORIZATION,
  TEST_RECIPIENT,
  classifyReport,
  providerEvidence,
  parsePercentNear,
  parsePass,
  execute,
  testOne
};
