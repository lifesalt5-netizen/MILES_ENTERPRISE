'use strict';

function clean(v) { return String(v || '').trim(); }
function normalizeMessageId(value) {
  return clean(value).replace(/^<|>$/g, '').trim().toLowerCase();
}
function extractMessageIds(value) {
  const text = clean(value);
  const angled = [...text.matchAll(/<([^>]+)>/g)].map(match => normalizeMessageId(match[1])).filter(Boolean);
  if (angled.length) return angled;
  return text.split(/\s+/).map(normalizeMessageId).filter(item => item && item.includes('@'));
}
function threadReferenceIds(message = {}) {
  return [...new Set([
    ...extractMessageIds(message.inReplyTo),
    ...extractMessageIds(message.references)
  ])];
}
function sentMessageIdSet(messages = []) {
  return new Set(messages.map(message => normalizeMessageId(message && message.messageId)).filter(Boolean));
}
function hasVerifiedSentThread(message = {}, sentIds = new Set()) {
  if (!(sentIds instanceof Set) || sentIds.size === 0) return false;
  return threadReferenceIds(message).some(id => sentIds.has(id));
}

module.exports = {
  normalizeMessageId,
  extractMessageIds,
  threadReferenceIds,
  sentMessageIdSet,
  hasVerifiedSentThread
};
