'use strict';

const AUTO_SEND_CATEGORIES = Object.freeze(['INTERESTED', 'MEETING', 'PRICING', 'REFERRAL']);

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function evaluateQualifiedReplyForAutonomy(reply = {}) {
  const category = normalize(reply.category || reply.classification || reply.replyCategory);
  const confidence = Number(reply.confidence ?? reply.score ?? 0);
  const hasReplyIdentity = Boolean(reply.reply_to_uuid || reply.replyToUuid || reply.email_uuid);
  const hasSenderAccount = Boolean(reply.eaccount || reply.sender_account || reply.senderAccount);
  const suppressed = Boolean(reply.suppressed || reply.globallySuppressed || reply.optOut || reply.unsubscribe);
  const humanQualified = AUTO_SEND_CATEGORIES.includes(category);

  const eligible = humanQualified && confidence >= 0.9 && hasReplyIdentity && hasSenderAccount && !suppressed;

  return {
    eligible,
    category,
    confidence,
    hasReplyIdentity,
    hasSenderAccount,
    suppressed,
    action: eligible ? 'PREPARE_GOVERNED_REPLY' : 'NO_AUTONOMOUS_REPLY',
    reason: eligible
      ? 'Qualified positive human reply with required Instantly reply identity and sender account.'
      : !humanQualified
        ? 'Reply category is not approved for autonomous positive follow-up.'
        : confidence < 0.9
          ? 'Reply confidence is below autonomous threshold.'
          : suppressed
            ? 'Reply/contact is suppressed or opted out.'
            : !hasReplyIdentity
              ? 'Missing Instantly reply UUID.'
              : 'Missing Instantly sender account.'
  };
}

module.exports = { AUTO_SEND_CATEGORIES, evaluateQualifiedReplyForAutonomy };
