'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DRAFT_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'REPLY_DRAFTING', 'STATE_SLED_FL_POSITIVE_REPLY_DRAFTS.json');
const INSTANTLY_CONNECTOR = path.join(ROOT, 'CONNECTORS', 'INSTANTLY', 'connector.js');
const INSTANTLY_CLIENT = path.join(ROOT, 'CONNECTORS', 'INSTANTLY', 'instantly.js');

function fileText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function run() {
  const draftArtifactPresent = fs.existsSync(DRAFT_FILE);
  let draftArtifact = {};
  if (draftArtifactPresent) {
    try { draftArtifact = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf8')); } catch { draftArtifact = {}; }
  }

  const connectorText = fileText(INSTANTLY_CONNECTOR);
  const clientText = fileText(INSTANTLY_CLIENT);

  const discoveredCapabilities = {
    draftArtifactPresent,
    draftsPrepared: Number(draftArtifact?.summary?.draftsPrepared ?? draftArtifact?.draftsPrepared ?? 0),
    instantlyReadReplies: /readReplies|listReceivedEmails|listEmails/.test(connectorText + clientText),
    instantlySendReply: /sendReply|replyToEmail|replyEmail|sendEmail/.test(connectorText + clientText),
    crmPersistence: fs.existsSync(path.join(ROOT, 'SERVICES', 'CanonicalCrmService.js')),
    calendlyRouting: fs.existsSync(path.join(ROOT, 'SERVICES', 'StateSledFlCalendlyMeetingRoutingService.js'))
  };

  const checks = {
    draftArtifactPresent: discoveredCapabilities.draftArtifactPresent,
    instantlyReadReplies: discoveredCapabilities.instantlyReadReplies,
    crmPersistence: discoveredCapabilities.crmPersistence,
    calendlyRouting: discoveredCapabilities.calendlyRouting
  };

  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const result = {
    ok: true,
    gate: 'P1.3Z_FL_GOVERNED_REPLY_SEND_READINESS',
    discoveredCapabilities,
    checks,
    failedChecks,
    replySendCapabilityPresent: discoveredCapabilities.instantlySendReply,
    readyForGovernedReplySendImplementation: failedChecks.length === 0,
    safety: {
      sendReplies: false,
      moveMailboxMessages: false,
      createCalendarEvents: false,
      mutateInstantlyCampaigns: false,
      automaticCrmWrites: false
    },
    mutationAttempted: false
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'REPLY_SEND_READINESS');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_GOVERNED_REPLY_SEND_READINESS.json');
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  result.outputFile = outputFile;
  return result;
}

module.exports = { run };
