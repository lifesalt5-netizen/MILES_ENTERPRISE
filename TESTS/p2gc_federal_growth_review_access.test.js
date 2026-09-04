'use strict';

const assert = require('assert');
const Access = require('../SERVICES/revenue/P2GCFederalGrowthReviewAccessService');

const svc = new Access({
  secret: '0123456789abcdef0123456789abcdef0123456789abcdef',
  maxConcurrentSessions: 2,
  sessionTtlSeconds: 3600,
  videoTokenTtlSeconds: 300
});

const review = {
  reviewId: 'P2GC-FGR-TEST-1',
  expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
  company: { name: 'TEST FEDERAL CO' },
  recipient: { email: 'owner@testfederal.example', companyDomain: 'testfederal.example' },
  security: { revokedAt: null }
};

const accessToken = svc.createAccessToken(review, { ttlSeconds: 1800 });
assert.strictEqual(svc.validateRecipientAccess(accessToken, review, 'owner@testfederal.example').ok, true);
assert.strictEqual(svc.validateRecipientAccess(accessToken, review, 'peer@testfederal.example').reason, 'SAME_COMPANY_AUTHORIZATION_REQUIRED');
assert.strictEqual(svc.validateRecipientAccess(accessToken, review, 'attacker@example.net').reason, 'OUTSIDE_ORGANIZATION_ACCESS_DENIED');

const s1 = svc.openSession(review, 'owner@testfederal.example', { ip: '1.2.3.4', userAgent: 'browser-a' });
const s2 = svc.openSession(review, 'owner@testfederal.example', { ip: '1.2.3.4', userAgent: 'browser-b' });
const s3 = svc.openSession(review, 'owner@testfederal.example', { ip: '1.2.3.5', userAgent: 'browser-c' });
assert.strictEqual(s1.ok, true);
assert.strictEqual(s1.session.suspicious, false);
assert.deepStrictEqual(s1.session.suspiciousReasons, []);
assert.strictEqual(s2.ok, true);
assert.strictEqual(s2.session.suspicious, true);
assert(s2.session.suspiciousReasons.includes('USER_AGENT_CONTEXT_CHANGED'));
assert(!s2.session.suspiciousReasons.includes('IP_CONTEXT_CHANGED'));
assert.ok(s2.session.suspiciousDetectedAt);
assert.strictEqual(s3.reason, 'CONCURRENT_SESSION_LIMIT_REACHED');
assert.strictEqual(svc.validateSession(review.reviewId,'owner@testfederal.example',s1.session.sessionId).ok,true);
assert.strictEqual(svc.validateSession(review.reviewId,'owner@testfederal.example','missing-session').reason,'SESSION_NOT_ACTIVE');

const mediaToken = svc.createVideoToken(review, 'owner@testfederal.example', s1.session.sessionId, 'review-video-1');
assert.strictEqual(svc.validateVideoToken(mediaToken, {
  reviewId: review.reviewId,
  authenticatedEmail: 'owner@testfederal.example',
  sessionId: s1.session.sessionId,
  mediaId: 'review-video-1'
}).ok, true);
assert.strictEqual(svc.validateVideoToken(mediaToken, {
  reviewId: review.reviewId,
  authenticatedEmail: 'owner@testfederal.example',
  sessionId: s1.session.sessionId,
  mediaId: 'other-video'
}).reason, 'VIDEO_TOKEN_MEDIA_MISMATCH');

assert.strictEqual(svc.closeSession(review.reviewId,'owner@testfederal.example',s1.session.sessionId).ok,true);
assert.strictEqual(svc.validateSession(review.reviewId,'owner@testfederal.example',s1.session.sessionId).reason,'SESSION_CLOSED');
assert.strictEqual(svc.validateSession(review.reviewId,'owner@testfederal.example',s2.session.sessionId).ok,true);

const s4 = svc.openSession(review, 'owner@testfederal.example', { ip: '1.2.3.5', userAgent: 'browser-b' });
assert.strictEqual(s4.ok, true);
assert.strictEqual(s4.session.suspicious, true);
assert(s4.session.suspiciousReasons.includes('IP_CONTEXT_CHANGED'));

const restarted = new Access({
  secret: '0123456789abcdef0123456789abcdef0123456789abcdef',
  maxConcurrentSessions: 2,
  sessionTtlSeconds: 3600,
  videoTokenTtlSeconds: 300
});
assert.strictEqual(restarted.validateSession(review.reviewId,'owner@testfederal.example',s2.session.sessionId).reason,'SESSION_NOT_ACTIVE');

const wm = svc.watermarkContext(review, 'owner@testfederal.example');
assert.ok(wm.label.includes('owner@testfederal.example'));
assert.ok(wm.label.includes('TEST FEDERAL CO'));

const headers = svc.publicSecurityHeaders();
assert.ok(headers['X-Robots-Tag'].includes('noindex'));
assert.ok(headers['Cache-Control'].includes('no-store'));

review.security.revokedAt = new Date().toISOString();
assert.strictEqual(svc.validateRecipientAccess(accessToken, review, 'owner@testfederal.example').reason, 'REVIEW_REVOKED');

console.log('P2GC_FEDERAL_GROWTH_REVIEW_ACCESS_TEST_GREEN');
