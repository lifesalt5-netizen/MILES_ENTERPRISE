'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, 'CONFIG', 'state_sled_fl_positive_reply_drafting_rules.json');
const ROUTING_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'MEETING_ROUTING', 'STATE_SLED_FL_CALENDLY_MEETING_ROUTING.json');

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
}

function loadRoutingArtifact() {
  if (!fs.existsSync(ROUTING_FILE)) {
    throw new Error(`Meeting routing artifact not found: ${ROUTING_FILE}`);
  }
  return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8'));
}

function buildDraft(candidate, rules) {
  const raw = candidate.raw || candidate;
  const originalSubject = String(raw.subject || raw.email_subject || raw.subject_line || '').trim();
  const subject = originalSubject
    ? (/^re:/i.test(originalSubject) ? originalSubject : `${rules.draftTemplate.subjectPrefix} ${originalSubject}`)
    : 'Re: Florida government contracting';
  const body = rules.draftTemplate.body.replace('{{CALENDLY_URL}}', rules.calendlyUrl);
  const email = String(candidate.email || raw.from_email || raw.sender_email || raw.email || '').trim();

  return {
    email,
    classification: 'POSITIVE',
    subject,
    body,
    calendlyUrl: rules.calendlyUrl,
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    proposedCrmStage: 'Meeting Set',
    sendAuthorized: false
  };
}

function run() {
  const rules = loadRules();
  const routing = loadRoutingArtifact();
  const candidates = Array.isArray(routing.candidates) ? routing.candidates : [];
  const eligible = candidates.filter(c => rules.eligibleClasses.includes(String(c.classification || '').toUpperCase()));
  const drafts = eligible.map(c => buildDraft(c, rules));

  const summary = {
    ok: true,
    gate: rules.gate,
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    meetingCandidatesObserved: candidates.length,
    draftsPrepared: drafts.length,
    drafts,
    readyForGovernedSendImplementation: true,
    safety: { ...rules.safety },
    mutationAttempted: false
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'REPLY_DRAFTING');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_POSITIVE_REPLY_DRAFTS.json');
  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  summary.outputFile = outputFile;
  return summary;
}

module.exports = { run, buildDraft, loadRoutingArtifact };
