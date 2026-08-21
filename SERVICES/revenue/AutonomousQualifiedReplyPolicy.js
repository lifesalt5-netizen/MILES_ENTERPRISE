'use strict';

const AUTO_SEND_CATEGORIES = Object.freeze([
  'INTERESTED',
  'MEETING_INTENT',
  'PRICING_QUESTION',
  'REFERRAL'
]);

function normalize(value) {
  const category = String(value || '').trim().toUpperCase();
  if (category === 'MEETING') return 'MEETING_INTENT';
  if (category === 'PRICING') return 'PRICING_QUESTION';
  return category;
}

function evaluateQualifiedReplyForAutonomy(reply = {}) {
  const category = normalize(reply.category || reply.classification || reply.replyCategory);
  const confidence = Number(reply.confidence ?? reply.score ?? 0);
  const hasReplyIdentity = Boolean(reply.reply_to_uuid || reply.replyToUuid || reply.email_uuid || reply.emailId);
  const hasSenderAccount = Boolean(reply.eaccount || reply.sender_account || reply.senderAccount);
  const suppressed = Boolean(reply.suppressed || reply.globallySuppressed || reply.optOut || reply.unsubscribe || reply.hardSuppression);
  const humanQualified = AUTO_SEND_CATEGORIES.includes(category) && reply.qualifiedPositive !== false && reply.humanReply !== false;

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
              ? 'Missing Instantly reply UUID/email identity.'
              : 'Missing Instantly sender account.'
  };
}

module.exports = { AUTO_SEND_CATEGORIES, evaluateQualifiedReplyForAutonomy };
