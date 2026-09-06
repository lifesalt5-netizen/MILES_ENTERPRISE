'use strict';

const crypto = require('crypto');

const DEFAULT_PROTECTED_DOMAINS = ['p2gc.com'];
const DEFAULT_SECONDARY_DOMAINS = [
  'pathwaysgov.com',
  'pathwaysfederal.com',
  'pathwaysgovcon.com',
  'pathwaystogc.com',
  'pathwaysgsa.com',
  'pathways2gc.co'
];

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function domainOf(email) {
  const value = lower(email);
  const at = value.lastIndexOf('@');
  return at >= 0 ? value.slice(at + 1) : '';
}
function csv(value) { return clean(value).split(',').map(lower).filter(Boolean); }
function protectedDomains() {
  return new Set([...DEFAULT_PROTECTED_DOMAINS, ...csv(process.env.MILES_P2GC_PROTECTED_COLD_DOMAINS || '')]);
}
function secondaryDomains() {
  return new Set([...DEFAULT_SECONDARY_DOMAINS, ...csv(process.env.MILES_P2GC_SECONDARY_COLD_DOMAINS || '')]);
}
function isProtectedDomain(value) {
  const d = value.includes('@') ? domainOf(value) : lower(value);
  return protectedDomains().has(d);
}
function isApprovedSecondaryDomain(value) {
  const d = value.includes('@') ? domainOf(value) : lower(value);
  return secondaryDomains().has(d);
}
function normalizeVisibleSenderName(value) {
  const requested = clean(value);
  if (!requested || /^kevin(?:\s+carter)?$/i.test(requested)) return 'Kevin';
  return requested;
}
function validateVisibleIdentity({ senderName, companyName } = {}) {
  const normalizedName = normalizeVisibleSenderName(senderName);
  if (normalizedName !== 'Kevin') {
    return { ok: false, code: 'P2GC_VISIBLE_SENDER_NAME_BLOCKED', requiredSenderName: 'Kevin', received: clean(senderName) };
  }
  const company = clean(companyName || 'Pathways 2 Government Contracting');
  return { ok: true, senderName: 'Kevin', companyName: company };
}
function assertColdSenderSafe(senderEmail, { mailboxHealthy = false, healthVerifiedAt = null } = {}) {
  const email = lower(senderEmail);
  const domain = domainOf(email);
  if (!email || !domain) return { ok: false, code: 'P2GC_COLD_SENDER_REQUIRED' };
  if (isProtectedDomain(domain)) {
    return { ok: false, code: 'P2GC_PRIMARY_DOMAIN_COLD_SEND_HARD_BLOCK', senderEmail: email, domain, protected: true, failoverAllowed: false };
  }
  if (!isApprovedSecondaryDomain(domain)) {
    return { ok: false, code: 'P2GC_COLD_SENDER_NOT_APPROVED_SECONDARY_DOMAIN', senderEmail: email, domain, approvedSecondaryDomains: [...secondaryDomains()] };
  }
  if (!mailboxHealthy || !healthVerifiedAt) {
    return { ok: false, code: 'P2GC_COLD_SENDER_HEALTH_NOT_VERIFIED', senderEmail: email, domain, healthRequired: true };
  }
  return { ok: true, senderEmail: email, domain, healthVerifiedAt };
}
function validateFirstTouch({ body, hasAttachment = false, hasCalendly = false, diagnosticLink = '', asksForMeeting = false } = {}) {
  const text = clean(body);
  const errors = [];
  if (hasAttachment) errors.push('ATTACHMENT_FORBIDDEN_FIRST_TOUCH');
  if (hasCalendly || /calendly/i.test(text)) errors.push('CALENDLY_FORBIDDEN_FIRST_TOUCH');
  if (diagnosticLink || /\/r\/[a-z0-9_-]{8,}/i.test(text)) errors.push('PRIVATE_DIAGNOSTIC_LINK_FORBIDDEN_FIRST_TOUCH');
  if (asksForMeeting || /book|schedule|calendar|15\s*[-–]?\s*20\s*minute|call/i.test(text)) errors.push('MEETING_CTA_FORBIDDEN_FIRST_TOUCH');
  return { ok: errors.length === 0, errors, objective: 'GET_PERMISSION_TO_SEND_PRIVATE_DIAGNOSTIC' };
}
function positiveReplyIntent(text) {
  const value = lower(text);
  return /\b(yes|sure|send it|send over|what did you find|i(?:'|’)d like to see it|interested|please send)\b/.test(value);
}
function createPrivateDiagnosticToken(bytes = 24) {
  return crypto.randomBytes(Math.max(16, Number(bytes) || 24)).toString('base64url');
}
function buildPrivateDiagnosticPath(token) {
  const value = clean(token);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(value)) throw new Error('P2GC_PRIVATE_DIAGNOSTIC_TOKEN_INVALID');
  return `/r/${value}`;
}
function qualifiesForKevinCalendar({ fullReviewRequested = false, goal = '', executionPreference = '', timing = '', willingnessToInvest = '', substantiveSalesQuestion = false, realOpportunity = false } = {}) {
  const t = lower(timing).replace(/\s+/g, '_');
  const w = lower(willingnessToInvest).replace(/\s+/g, '_');
  const researchOnly = /just_researching/.test(t) || /no.*only.*gather/.test(w);
  const complete = Boolean(clean(goal) && clean(executionPreference) && clean(timing) && clean(willingnessToInvest));
  const highIntent = !researchOnly && (fullReviewRequested || substantiveSalesQuestion || realOpportunity) && complete;
  return { ok: highIntent, highIntent, researchOnly, completeQualification: complete, route: highIntent ? 'KEVIN_CALENDAR' : 'NURTURE_OR_CONTINUE_QUALIFICATION' };
}
function activityRecord(input = {}) {
  const timestamp = input.timestamp || new Date().toISOString();
  return {
    id: input.id || `mkt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    timestamp,
    channel: clean(input.channel || 'UNKNOWN').toUpperCase(),
    systemUser: clean(input.systemUser || 'MILES'),
    campaign: clean(input.campaign),
    segment: clean(input.segment),
    action: clean(input.action),
    recipient: clean(input.recipient),
    audienceSize: Number(input.audienceSize || 0),
    senderMailbox: lower(input.senderMailbox),
    senderDisplayName: 'Kevin',
    subject: clean(input.subject),
    messageVersion: clean(input.messageVersion || 'v1'),
    message: clean(input.message),
    renderedMessage: clean(input.renderedMessage || input.message),
    status: clean(input.status || 'PLANNED').toUpperCase(),
    result: input.result || null,
    reply: input.reply || null,
    linkActivity: input.linkActivity || null,
    funnel: input.funnel || null
  };
}

module.exports = {
  DEFAULT_PROTECTED_DOMAINS,
  DEFAULT_SECONDARY_DOMAINS,
  domainOf,
  isProtectedDomain,
  isApprovedSecondaryDomain,
  normalizeVisibleSenderName,
  validateVisibleIdentity,
  assertColdSenderSafe,
  validateFirstTouch,
  positiveReplyIntent,
  createPrivateDiagnosticToken,
  buildPrivateDiagnosticPath,
  qualifiesForKevinCalendar,
  activityRecord
};
