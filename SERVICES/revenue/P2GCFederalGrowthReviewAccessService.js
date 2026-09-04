'use strict';

const crypto = require('crypto');

function clean(v) { return String(v == null ? '' : v).trim(); }
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function unb64url(input) { return Buffer.from(input, 'base64url').toString('utf8'); }
function timingSafeEqualString(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function contextHash(value) {
  const normalized = clean(value);
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}

class P2GCFederalGrowthReviewAccessService {
  constructor(options = {}) {
    this.secret = clean(options.secret || process.env.P2GC_REVIEW_TOKEN_SECRET);
    this.issuer = clean(options.issuer || 'P2GC_FEDERAL_GROWTH_REVIEW');
    this.videoTokenTtlSeconds = Math.max(60, Number(options.videoTokenTtlSeconds || 300));
    this.sessionTtlSeconds = Math.max(300, Number(options.sessionTtlSeconds || 3600));
    this.maxConcurrentSessions = Math.max(1, Number(options.maxConcurrentSessions || 2));
    this.sessionStore = options.sessionStore || new Map();
  }

  requireSecret() {
    if (!this.secret || this.secret.length < 32) throw new Error('P2GC_REVIEW_TOKEN_SECRET_REQUIRED_MIN_32_CHARS');
  }

  signPayload(payload) {
    this.requireSecret();
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'P2GC-REVIEW' }));
    const body = b64url(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', this.secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  verifyToken(token, options = {}) {
    this.requireSecret();
    const [header, body, signature, extra] = String(token || '').split('.');
    if (!header || !body || !signature || extra) return { ok: false, reason: 'TOKEN_FORMAT_INVALID' };
    const expected = crypto.createHmac('sha256', this.secret).update(`${header}.${body}`).digest('base64url');
    if (!timingSafeEqualString(signature, expected)) return { ok: false, reason: 'TOKEN_SIGNATURE_INVALID' };
    let payload;
    try { payload = JSON.parse(unb64url(body)); }
    catch { return { ok: false, reason: 'TOKEN_PAYLOAD_INVALID' }; }
    if (payload.iss !== this.issuer) return { ok: false, reason: 'TOKEN_ISSUER_INVALID' };
    const now = Math.floor(Date.now() / 1000);
    if (Number(payload.exp || 0) <= now) return { ok: false, reason: 'TOKEN_EXPIRED', payload };
    if (payload.nbf && Number(payload.nbf) > now) return { ok: false, reason: 'TOKEN_NOT_YET_VALID', payload };
    if (options.kind && payload.kind !== options.kind) return { ok: false, reason: 'TOKEN_KIND_INVALID', payload };
    if (options.reviewId && payload.reviewId !== options.reviewId) return { ok: false, reason: 'TOKEN_REVIEW_MISMATCH', payload };
    return { ok: true, payload };
  }

  createAccessToken(reviewRecord, options = {}) {
    const recipient = clean(reviewRecord?.recipient?.email).toLowerCase();
    if (!reviewRecord?.reviewId || !recipient) throw new Error('REVIEW_AND_RECIPIENT_REQUIRED');
    const now = Math.floor(Date.now() / 1000);
    const reviewExp = Math.floor(Date.parse(reviewRecord.expiresAt || 0) / 1000);
    if (!Number.isFinite(reviewExp) || reviewExp <= now) throw new Error('REVIEW_ALREADY_EXPIRED');
    const requested = Math.max(300, Number(options.ttlSeconds || 3600));
    const exp = Math.min(reviewExp, now + requested);
    return this.signPayload({
      iss: this.issuer,
      kind: 'REVIEW_ACCESS',
      reviewId: reviewRecord.reviewId,
      recipientEmail: recipient,
      companyDomain: clean(reviewRecord?.recipient?.companyDomain).toLowerCase() || null,
      companyName: clean(reviewRecord?.company?.name) || null,
      iat: now,
      nbf: now - 5,
      exp,
      jti: crypto.randomUUID()
    });
  }

  validateRecipientAccess(token, reviewRecord, authenticatedEmail) {
    const verified = this.verifyToken(token, { kind: 'REVIEW_ACCESS', reviewId: reviewRecord?.reviewId });
    if (!verified.ok) return verified;
    if (reviewRecord?.security?.revokedAt) return { ok: false, reason: 'REVIEW_REVOKED' };
    if (Date.now() >= Date.parse(reviewRecord?.expiresAt || 0)) return { ok: false, reason: 'REVIEW_EXPIRED' };
    const email = clean(authenticatedEmail).toLowerCase();
    if (!email) return { ok: false, reason: 'AUTHENTICATED_EMAIL_REQUIRED' };
    const approved = clean(reviewRecord?.recipient?.email).toLowerCase();
    if (email !== approved) {
      const domain = email.split('@')[1] || '';
      const approvedDomain = clean(reviewRecord?.recipient?.companyDomain).toLowerCase();
      if (domain && approvedDomain && domain === approvedDomain) {
        return { ok: false, reason: 'SAME_COMPANY_AUTHORIZATION_REQUIRED' };
      }
      return { ok: false, reason: 'OUTSIDE_ORGANIZATION_ACCESS_DENIED' };
    }
    if (verified.payload.recipientEmail !== approved) return { ok: false, reason: 'TOKEN_RECIPIENT_BINDING_INVALID' };
    return { ok: true, access: 'PRIMARY_RECIPIENT', payload: verified.payload };
  }

  openSession(reviewRecord, authenticatedEmail, client = {}) {
    const reviewId = clean(reviewRecord?.reviewId);
    const email = clean(authenticatedEmail).toLowerCase();
    if (!reviewId || !email) throw new Error('REVIEW_ID_AND_EMAIL_REQUIRED');
    const key = `${reviewId}::${email}`;
    const now = Date.now();
    const sessions = (this.sessionStore.get(key) || []).filter(s => s.expiresAtMs > now && !s.closedAt);
    if (sessions.length >= this.maxConcurrentSessions) {
      return { ok: false, reason: 'CONCURRENT_SESSION_LIMIT_REACHED', activeSessions: sessions.length };
    }

    const ipHash = contextHash(client.ip);
    const userAgentHash = contextHash(client.userAgent);
    const suspiciousReasons = [];
    if (sessions.some(s => s.ipHash && ipHash && s.ipHash !== ipHash)) suspiciousReasons.push('IP_CONTEXT_CHANGED');
    if (sessions.some(s => s.userAgentHash && userAgentHash && s.userAgentHash !== userAgentHash)) suspiciousReasons.push('USER_AGENT_CONTEXT_CHANGED');

    const session = {
      sessionId: crypto.randomUUID(),
      reviewId,
      authenticatedEmail: email,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTtlSeconds * 1000).toISOString(),
      expiresAtMs: now + this.sessionTtlSeconds * 1000,
      ipHash,
      userAgentHash,
      suspicious: suspiciousReasons.length > 0,
      suspiciousReasons,
      suspiciousDetectedAt: suspiciousReasons.length ? new Date(now).toISOString() : null,
      closedAt: null
    };
    sessions.push(session);
    this.sessionStore.set(key, sessions);
    return { ok: true, session: { ...session, expiresAtMs: undefined } };
  }

  validateSession(reviewId, authenticatedEmail, sessionId) {
    const rid = clean(reviewId);
    const email = clean(authenticatedEmail).toLowerCase();
    const sid = clean(sessionId);
    if (!rid || !email || !sid) return { ok: false, reason: 'SESSION_CONTEXT_REQUIRED' };
    const key = `${rid}::${email}`;
    const sessions = this.sessionStore.get(key) || [];
    const found = sessions.find(s => s.sessionId === sid);
    if (!found) return { ok: false, reason: 'SESSION_NOT_ACTIVE' };
    if (found.closedAt) return { ok: false, reason: 'SESSION_CLOSED' };
    if (Number(found.expiresAtMs || 0) <= Date.now()) return { ok: false, reason: 'SESSION_EXPIRED' };
    if (found.reviewId !== rid || found.authenticatedEmail !== email) return { ok: false, reason: 'SESSION_BINDING_MISMATCH' };
    return { ok: true, session: { ...found, expiresAtMs: undefined } };
  }

  closeSession(reviewId, authenticatedEmail, sessionId) {
    const key = `${clean(reviewId)}::${clean(authenticatedEmail).toLowerCase()}`;
    const sessions = this.sessionStore.get(key) || [];
    const found = sessions.find(s => s.sessionId === sessionId);
    if (!found) return { ok: false, reason: 'SESSION_NOT_FOUND' };
    found.closedAt = new Date().toISOString();
    this.sessionStore.set(key, sessions);
    return { ok: true };
  }

  createVideoToken(reviewRecord, authenticatedEmail, sessionId, mediaId) {
    const email = clean(authenticatedEmail).toLowerCase();
    const reviewId = clean(reviewRecord?.reviewId);
    const media = clean(mediaId);
    if (!reviewId || !email || !sessionId || !media) throw new Error('VIDEO_TOKEN_CONTEXT_REQUIRED');
    const now = Math.floor(Date.now() / 1000);
    const reviewExp = Math.floor(Date.parse(reviewRecord.expiresAt || 0) / 1000);
    const exp = Math.min(reviewExp, now + this.videoTokenTtlSeconds);
    return this.signPayload({
      iss: this.issuer,
      kind: 'VIDEO_STREAM',
      reviewId,
      recipientEmail: email,
      sessionId,
      mediaId: media,
      iat: now,
      nbf: now - 5,
      exp,
      jti: crypto.randomUUID()
    });
  }

  validateVideoToken(token, context = {}) {
    const verified = this.verifyToken(token, { kind: 'VIDEO_STREAM', reviewId: context.reviewId });
    if (!verified.ok) return verified;
    const p = verified.payload;
    if (context.authenticatedEmail && p.recipientEmail !== clean(context.authenticatedEmail).toLowerCase()) {
      return { ok: false, reason: 'VIDEO_TOKEN_RECIPIENT_MISMATCH' };
    }
    if (context.sessionId && p.sessionId !== context.sessionId) return { ok: false, reason: 'VIDEO_TOKEN_SESSION_MISMATCH' };
    if (context.mediaId && p.mediaId !== clean(context.mediaId)) return { ok: false, reason: 'VIDEO_TOKEN_MEDIA_MISMATCH' };
    return { ok: true, payload: p };
  }

  watermarkContext(reviewRecord, authenticatedEmail) {
    return {
      recipient: clean(authenticatedEmail).toLowerCase(),
      company: clean(reviewRecord?.company?.name),
      reviewId: clean(reviewRecord?.reviewId),
      label: `Confidential — ${clean(authenticatedEmail).toLowerCase()} — ${clean(reviewRecord?.company?.name)} — ${clean(reviewRecord?.reviewId)}`
    };
  }

  publicSecurityHeaders() {
    return {
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
      'Cache-Control': 'private, no-store, max-age=0',
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    };
  }
}

module.exports = P2GCFederalGrowthReviewAccessService;
