"use strict";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function bodyText(email = {}) {
  const text = email?.body?.text || email?.text || email?.body_text || email?.content_preview || email?.snippet || email?.message || "";
  return String(text || "").replace(/\r\n/g, "\n");
}

function senderEmail(email = {}) {
  return clean(email?.from_address_email || email?.from || email?.sender_email || email?.lead || email?.lead_email).toLowerCase();
}

function contextForEmail(combined, target) {
  const lower = combined.toLowerCase();
  const index = lower.indexOf(String(target || "").toLowerCase());
  if (index < 0) return "";
  return clean(combined.slice(Math.max(0, index - 180), Math.min(combined.length, index + target.length + 80)));
}

function roleScore(email, context = "") {
  const value = String(email || "").toLowerCase();
  const text = `${value} ${String(context || "").toLowerCase()}`;
  let score = 0;
  let role = "GENERAL";

  if (/\b(business development|biz dev|bd|growth|sales|partnerships?|capture|strategic growth)\b/i.test(text)) {
    score += 100;
    role = "BUSINESS_DEVELOPMENT";
  }
  if (/\b(contracts?|contracting|procurement|bids?|proposals?)\b/i.test(text)) {
    score += 70;
    if (role === "GENERAL") role = "CONTRACTS";
  }
  if (/\b(all other inquiries|general inquiries|info|contact us)\b/i.test(text)) {
    score += 25;
    if (role === "GENERAL") role = "GENERAL_INQUIRY";
  }
  if (/\b(finance|accounts payable|payables?|billing|invoice|ap)\b/i.test(text)) {
    score -= 60;
    role = "FINANCE_AP";
  }
  if (/\b(human resources|hr|careers?|jobs?|recruiting|talent)\b/i.test(text)) {
    score -= 80;
    role = "HR";
  }

  return { score, role };
}

function rankReplacementEmails(combined, emails = []) {
  return emails
    .map((email, index) => {
      const context = contextForEmail(combined, email);
      const scored = roleScore(email, context);
      return { email, context, role: scored.role, score: scored.score, sourceOrder: index };
    })
    .sort((a, b) => b.score - a.score || a.sourceOrder - b.sourceOrder);
}

function extractReplacement(email = {}) {
  const subject = clean(email.subject);
  const body = bodyText(email);
  const combined = `${subject}\n${body}`;

  const departed = [
    /\bno longer (?:with|at)\b/i,
    /\bhas left (?:the )?(?:company|organization|organisation|team)\b/i,
    /\bis no longer employed (?:with|at)\b/i,
    /\bemail (?:address|account) is no longer (?:monitored|active|valid)\b/i,
    /\bmailbox is no longer monitored\b/i
  ].some(pattern => pattern.test(combined));

  const redirect = [
    /\bplease (?:direct|send|forward) (?:(?:all|future)\s+)*(?:inquiries|requests|emails?|messages?) to\b/i,
    /\bplease (?:contact|reach out to|speak with)\b/i,
    /\bcontact .{0,100} instead\b/i,
    /\bfor (?:future|further) (?:inquiries|requests|assistance).{0,80}\b(?:contact|email|reach)\b/i,
    /\bfor assistance,? please contact\b/i
  ].some(pattern => pattern.test(combined));

  if (!departed || !redirect) return null;

  const original = senderEmail(email);
  const emails = [...new Set((combined.match(EMAIL_RE) || []).map(value => value.toLowerCase()))]
    .filter(value => value !== original);
  if (emails.length === 0) return null;

  const ranked = rankReplacementEmails(combined, emails);
  const primary = ranked[0];
  const replacementEmail = primary.email;
  const replacementContext = primary.context;
  const nameMatch = replacementContext.match(/(?:to|contact|with|inquiries to)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,3})\s+(?:at\s+)?$/);
  const replacementName = nameMatch ? clean(nameMatch[1]) : "";

  return {
    detected: true,
    departedContactEmail: original,
    replacementEmail,
    replacementName,
    replacementRole: primary.role,
    replacementScore: primary.score,
    replacementCandidates: ranked,
    evidence: clean(body).slice(0, 1500),
    evidenceType: "EXPLICIT_REPLACEMENT_CONTACT_NOTICE",
    confidence: 0.99,
    action: "REPLACE_CONTACT_AND_CONTINUE"
  };
}

class ReplacementContactRecoveryService {
  detect(email = {}) {
    return extractReplacement(email);
  }
}

module.exports = ReplacementContactRecoveryService;
module.exports.ReplacementContactRecoveryService = ReplacementContactRecoveryService;
module.exports.extractReplacement = extractReplacement;
module.exports.rankReplacementEmails = rankReplacementEmails;
module.exports.roleScore = roleScore;
