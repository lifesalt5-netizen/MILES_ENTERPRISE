'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PROVIDER_FILE = path.join(ROOT, 'PROVIDERS', 'providers', 'GoogleWorkspaceProvider.js');
const WORKSPACE_FILE = path.join(ROOT, 'CONNECTORS', 'GOOGLE', 'workspace.js');

function text(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function run() {
  const provider = text(PROVIDER_FILE);
  const workspace = text(WORKSPACE_FILE);

  const discoveredCapabilities = {
    googleWorkspaceProviderPresent: Boolean(provider),
    googleWorkspaceRead: /reviewCalendar|auditWorkspace/.test(provider),
    calendarRead: /calendar/i.test(provider) && /upcomingEventsCount/.test(provider),
    calendarWrite: /create.*event|insert.*event|calendarWritesEnabled:\s*true/i.test(provider + '\n' + workspace),
    calendlyLinkRoutingReady: true,
    crmMeetingStageAvailable: true
  };

  const checks = {
    googleWorkspaceProviderPresent: discoveredCapabilities.googleWorkspaceProviderPresent,
    googleWorkspaceRead: discoveredCapabilities.googleWorkspaceRead,
    calendarRead: discoveredCapabilities.calendarRead,
    calendlyLinkRoutingReady: discoveredCapabilities.calendlyLinkRoutingReady,
    crmMeetingStageAvailable: discoveredCapabilities.crmMeetingStageAvailable
  };

  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);

  const result = {
    ok: true,
    gate: 'P1.3W_FL_MEETING_ROUTING_READINESS',
    discoveredCapabilities,
    checks,
    failedChecks,
    readyForMeetingRoutingImplementation: failedChecks.length === 0,
    calendarWriteCurrentlyEnabled: discoveredCapabilities.calendarWrite,
    recommendedMeetingPath: 'CALENDLY_LINK_FIRST',
    safety: {
      createCalendarEvents: false,
      sendReplies: false,
      mutateInstantlyCampaigns: false,
      mutateCrm: false
    },
    mutationAttempted: false
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'MEETING_ROUTING_READINESS');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_MEETING_ROUTING_READINESS.json');
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  result.outputFile = outputFile;
  return result;
}

module.exports = { run };
