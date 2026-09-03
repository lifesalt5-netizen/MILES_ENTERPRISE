'use strict';

const crypto = require('crypto');

function clean(v){ return String(v == null ? '' : v).trim(); }
function email(v){ return clean(v).toLowerCase(); }
function hash(value, salt){ return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex'); }

class P2GCFederalGrowthReviewVerificationService {
  constructor(options = {}) {
    this.sender = options.sender || require('../../CONNECTORS/IONOS/smtp_governed');
    this.ttlMs = Math.max(2 * 60 * 1000, Number(options.ttlMs || 10 * 60 * 1000));
    this.maxAttempts = Math.max(2, Number(options.maxAttempts || 5));
    this.store = options.store || new Map();
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
  }

  key(reviewId, recipientEmail){
    return `${clean(reviewId)}::${email(recipientEmail)}`;
  }

  createCode(){
    return String(crypto.randomInt(100000, 1000000));
  }

  async requestCode(reviewRecord, requestedEmail){
    const approved = email(reviewRecord?.recipient?.email);
    const requested = email(requestedEmail);
    if (!reviewRecord?.reviewId || !approved) throw new Error('REVIEW_RECIPIENT_CONTEXT_REQUIRED');
    if (requested !== approved) {
      const requestedDomain = requested.split('@')[1] || '';
      const approvedDomain = email(reviewRecord?.recipient?.companyDomain);
      if (requestedDomain && approvedDomain && requestedDomain === approvedDomain) {
        return { ok:false, reason:'SAME_COMPANY_AUTHORIZATION_REQUIRED' };
      }
      return { ok:false, reason:'OUTSIDE_ORGANIZATION_ACCESS_DENIED' };
    }
    if (reviewRecord?.security?.revokedAt) return { ok:false, reason:'REVIEW_REVOKED' };
    if (this.now() >= Date.parse(reviewRecord?.expiresAt || 0)) return { ok:false, reason:'REVIEW_EXPIRED' };

    const code = this.createCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const now = this.now();
    this.store.set(this.key(reviewRecord.reviewId, approved), {
      codeHash: hash(code, salt),
      salt,
      createdAtMs: now,
      expiresAtMs: now + this.ttlMs,
      attempts: 0,
      consumedAtMs: null
    });

    await this.sender.sendEmail({
      from:'kevin@pathways2gc.com',
      replyTo:'kevin@pathways2gc.com',
      to: approved,
      subject:'Your P2GC Federal Growth Review verification code',
      text:[
        `Your verification code is: ${code}`,
        '',
        `Company: ${clean(reviewRecord?.company?.name)}`,
        `Review: ${clean(reviewRecord?.reviewId)}`,
        '',
        'This code expires in 10 minutes. If you did not request access, you can ignore this message.',
        '',
        'Kevin Chace',
        'Pathways 2 Government Contracting'
      ].join('\n')
    });

    return { ok:true, status:'VERIFICATION_CODE_SENT', recipientEmail:approved, expiresInSeconds:Math.floor(this.ttlMs/1000) };
  }

  verifyCode(reviewRecord, requestedEmail, code){
    const approved = email(reviewRecord?.recipient?.email);
    const requested = email(requestedEmail);
    if (!reviewRecord?.reviewId || requested !== approved) return { ok:false, reason:'RECIPIENT_MISMATCH' };
    const key = this.key(reviewRecord.reviewId, approved);
    const record = this.store.get(key);
    if (!record) return { ok:false, reason:'VERIFICATION_CODE_NOT_REQUESTED' };
    const now = this.now();
    if (record.consumedAtMs) return { ok:false, reason:'VERIFICATION_CODE_ALREADY_USED' };
    if (now >= record.expiresAtMs) return { ok:false, reason:'VERIFICATION_CODE_EXPIRED' };
    if (record.attempts >= this.maxAttempts) return { ok:false, reason:'VERIFICATION_ATTEMPTS_EXCEEDED' };
    record.attempts += 1;
    const candidate = hash(clean(code), record.salt);
    if (!crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(record.codeHash))) {
      this.store.set(key, record);
      return { ok:false, reason:'VERIFICATION_CODE_INVALID', attemptsRemaining:Math.max(0,this.maxAttempts-record.attempts) };
    }
    record.consumedAtMs = now;
    this.store.set(key, record);
    return { ok:true, status:'RECIPIENT_EMAIL_VERIFIED', authenticatedEmail:approved, verifiedAt:new Date(now).toISOString() };
  }
}

module.exports = P2GCFederalGrowthReviewVerificationService;
