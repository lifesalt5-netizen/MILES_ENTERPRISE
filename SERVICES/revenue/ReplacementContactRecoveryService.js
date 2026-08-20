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

function extractReplacement(email = {}) {
  const subject = clean(email.subject);
  const body = bodyText(email);
  const combined = `${subject}\n${body}`;
  const lower = combined.toLowerCase();

  const departed = [
    /\bno longer (?:with|at)\b/i,
    /\bhas left (?:the )?(?:company|organization|organisation|team)\b/i,
    /\bis no longer employed (?:with|at)\b/i,
    /\bemail (?:address|account) is no longer (?:monitored|active|valid)\b/i,
    /\bmailbox is no longer monitored\b/i
  ].some(pattern => pattern.test(combined));

  const redirect = [
    /\bplease (?:direct|send|forward) (?:all |future )?(?:inquiries|requests|emails?|messages?) to\b/i,
    /\bplease (?:contact|reach out to|speak with)\b/i,
    /\bcontact .{0,100} instead\b/i,
    /\bfor (?:future|further) (?:inquiries|requests|assistance).{0,80}\b(?:contact|email|reach)\b/i
  ].some(pattern => pattern.test(combined));

  if (!departed || !redirect) return null;

  const original = senderEmail(email);
  const emails = [...new Set((combined.match(EMAIL_RE) || []).map(value => value.toLowerCase()))]
    .filter(value => value !== original);
  if (emails.length === 0) return null;

  const replacementEmail = emails[0];
  const emailIndex = lower.indexOf(replacementEmail.toLowerCase());
  const contextStart = Math.max(0, emailIndex - 140);
  const context = clean(combined.slice(contextStart, emailIndex));
  const nameMatch = context.match(/(?:to|contact|with|inquiries to)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,3})\s+(?:at\s+)?$/);
  const replacementName = nameMatch ? clean(nameMatch[1]) : "";

  return {
    detected: true,
    departedContactEmail: original,
    replacementEmail,
    replacementName,
    evidence: clean(body).slice(0, 1000),
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
