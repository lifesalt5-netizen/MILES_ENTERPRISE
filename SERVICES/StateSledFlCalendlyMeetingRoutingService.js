'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, 'CONFIG', 'state_sled_fl_calendly_meeting_routing_rules.json');
const ROUTING_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'CRM_ROUTING', 'STATE_SLED_FL_REPLY_TO_CRM_ROUTING.json');

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadRules() {
  return loadJson(RULES_FILE);
}

function loadReplyRoutingArtifact() {
  return loadJson(ROUTING_FILE);
}

function buildMeetingCandidates(routes = [], rules) {
  return routes
    .filter(route => rules.meetingEligibleClasses.includes(String(route.classification || '').toUpperCase()))
    .map(route => ({
      email: route.email || '',
      classification: String(route.classification || '').toUpperCase(),
      currentProposedStage: route.proposedStage || null,
      proposedMeetingStage: rules.proposedMeetingStage,
      meetingPath: rules.meetingPath,
      calendlyUrl: rules.calendlyUrl,
      readyForCalendlyReply: Boolean(route.email),
      requiresHumanReview: false
    }));
}

function run() {
  const rules = loadRules();
  const artifact = loadReplyRoutingArtifact() || {};
  const routes = Array.isArray(artifact.plannedRoutes) ? artifact.plannedRoutes : [];
  const candidates = buildMeetingCandidates(routes, rules);

  const summary = {
    ok: true,
    gate: rules.gate,
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    meetingPath: rules.meetingPath,
    calendlyUrl: rules.calendlyUrl,
    routingCandidatesObserved: routes.length,
    meetingCandidates: candidates.length,
    candidates,
    readyForMeetingReplyImplementation: candidates.every(x => x.readyForCalendlyReply),
    calendarWriteRequired: false,
    safety: {
      sendReplies: false,
      createCalendarEvents: false,
      mutateInstantlyCampaigns: false,
      automaticCrmWrites: false
    },
    mutationAttempted: false
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'MEETING_ROUTING');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_CALENDLY_MEETING_ROUTING.json');
  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  summary.outputFile = outputFile;

  return summary;
}

module.exports = { run, loadReplyRoutingArtifact, buildMeetingCandidates };
