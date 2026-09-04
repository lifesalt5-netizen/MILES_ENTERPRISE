'use strict';

const fs = require('fs');
const path = require('path');
const readonly = require('../CONNECTORS/IONOS/imap_readonly');
const IonosInboxHygieneProductionLoopService = require('../SERVICES/revenue/IonosInboxHygieneProductionLoopService');
const { CATEGORIES } = require('../SERVICES/revenue/ReplyIntelligenceService');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
const ARTIFACT = path.join(ROOT, 'DATA', 'runtime', 'revenue', 'ionos_hygiene', 'ionos_inbox_hygiene_latest.json');
const MAX_AGE_MINUTES = Math.max(6, Number(process.env.MILES_IONOS_HYGIENE_AUDIT_MAX_AGE_MINUTES || 15));

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { return { __error: error.message, __file: file }; }
}

function ageMinutes(iso) {
  const ms = Date.parse(String(iso || ''));
  return Number.isFinite(ms) ? (Date.now() - ms) / 60000 : null;
}

function configuredAccounts() {
  try {
    return readonly.mailboxConfigs().map(row => String(row?.email || '').trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const artifact = readJson(ARTIFACT);
  const generatedAt = artifact?.generatedAt || null;
  const freshnessMinutes = ageMinutes(generatedAt);
  const configured = configuredAccounts();
  const observed = Array.isArray(artifact?.accounts)
    ? artifact.accounts.map(row => String(row?.account || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const missingAccounts = configured.filter(email => !observed.includes(email));

  const clients = new Set(['client@example.com']);
  const dmarcRoute = IonosInboxHygieneProductionLoopService.safeFolderFor(
    { category: CATEGORIES.UNKNOWN, humanReply: false },
    { from: 'noreply-dmarc-support@google.com', subject: 'Report domain: pathwaysgsa.com Submitter: google.com DMARC aggregate report' },
    clients
  );
  const humanRoute = IonosInboxHygieneProductionLoopService.safeFolderFor(
    { category: CATEGORIES.MEETING_INTENT, humanReply: true },
    { from: 'Client <client@example.com>', subject: 'Can we meet tomorrow?' },
    clients
  );

  const checks = {
    artifactReadable: !artifact?.__error,
    artifactFresh: freshnessMinutes != null && freshnessMinutes >= -1 && freshnessMinutes <= MAX_AGE_MINUTES,
    loopActive: artifact?.status === 'ACTIVE' && artifact?.enabled === true && artifact?.execute === true,
    allConfiguredAccountsObserved: configured.length > 0 && missingAccounts.length === 0,
    noRuntimeErrors: Array.isArray(artifact?.errors) && artifact.errors.length === 0,
    postVerificationGreen: Number(artifact?.totals?.remainingHighConfidenceRoutableNoise) === 0,
    uidMoveOnly: artifact?.safety?.usesUidMoveOnly === true && artifact?.safety?.deletesMessages === false,
    dmarcRoutesToSystem: dmarcRoute === 'MILES-SYSTEM',
    legitimateHumanMailStaysInbox: humanRoute === null
  };

  const failures = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  const result = {
    ok: failures.length === 0,
    service: 'MILES_IONOS_CONTINUOUS_HYGIENE_AUDIT',
    observedAt: new Date().toISOString(),
    artifact: ARTIFACT,
    artifactGeneratedAt: generatedAt,
    artifactAgeMinutes: freshnessMinutes == null ? null : Number(freshnessMinutes.toFixed(2)),
    maxAgeMinutes: MAX_AGE_MINUTES,
    configuredAccountCount: configured.length,
    observedAccountCount: observed.length,
    missingAccounts,
    status: artifact?.status || null,
    remainingHighConfidenceRoutableNoise: artifact?.totals?.remainingHighConfidenceRoutableNoise ?? null,
    routeCanaries: {
      googleDmarcAggregateReport: dmarcRoute,
      legitimateHumanMeetingIntent: humanRoute == null ? 'KEEP_INBOX' : humanRoute
    },
    checks,
    failures,
    safety: {
      mailboxReadPerformed: false,
      providerMutationPerformed: false,
      messageMovePerformed: false,
      messageDeletePerformed: false,
      smtpPerformed: false,
      dnsMutationPerformed: false,
      credentialsExposed: false
    }
  };

  console.log('MILES_IONOS_CONTINUOUS_HYGIENE_AUDIT');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) main();

module.exports = { ROOT, ARTIFACT, MAX_AGE_MINUTES, ageMinutes, configuredAccounts, main };
