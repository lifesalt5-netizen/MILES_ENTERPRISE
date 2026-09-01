'use strict';

const clientPortalPolicy = require('./ClientAuthorizedPortalAccessPolicyService');

function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toUpperCase(); }

class GsaEbuyAccessPolicyService {
  isEbuySource(record = {}) {
    const text = norm([
      record.source,
      record.sourceName,
      record.portal,
      record.sourceUrl,
      record.source_url,
      record.url
    ].filter(Boolean).join(' '));
    return /\bEBUY\b|EBUY\.GSA\.GOV/.test(text);
  }

  isHistoricalProxy(record = {}) {
    const access = norm(record.sourceAccess);
    const stage = norm(record.stage);
    return access === 'GSA_PUBLIC_HISTORICAL_PROXY' ||
      access === 'PUBLIC_AWARD_HISTORY' ||
      stage === 'RECENT_SIMILAR_AWARD';
  }

  evaluate(record = {}, context = {}) {
    if (!this.isEbuySource(record)) {
      return {
        allowed:true,
        status:'NOT_EBUY_SOURCE',
        live:false,
        requiresFallback:false
      };
    }

    if (this.isHistoricalProxy(record)) {
      return {
        allowed:true,
        status:'GSA_PUBLIC_HISTORICAL_PROXY',
        live:false,
        requiresFallback:false,
        requiredLabel:'GSA_PUBLIC_HISTORICAL_PROXY'
      };
    }

    const authorized = context.authorizedEbuyAccess === true || record.authorizedEbuyAccess === true;
    const evidence = clean(context.accessEvidenceId || record.accessEvidenceId || record.authorizedAccessEvidence);
    const inScope = context.withinGrantedScope !== false && record.withinGrantedScope !== false;

    if (authorized && evidence && inScope) {
      const clientGate = clientPortalPolicy.evaluate({
        ...context,
        authorizationEvidenceId:context.authorizationEvidenceId || evidence,
        withinGrantedScope:inScope
      });
      if (!clientGate.allowed) {
        return {
          allowed:false,
          status:clientGate.status,
          live:false,
          requiresFallback:true,
          fallbackMode:'PUBLIC_GSA_EVIDENCE_PLUS_RECENT_COMPARABLE_AWARD_HISTORY',
          reason:clientGate.reason,
          clientAccessGate:clientGate
        };
      }
      return {
        allowed:true,
        status:'AUTHORIZED_EBUY_LIVE',
        live:true,
        requiresFallback:false,
        requiredLabel:'AUTHORIZED_EBUY_LIVE',
        accessEvidenceId:evidence,
        clientAccessGate:clientGate
      };
    }

    return {
      allowed:false,
      status:'EBUY_LIVE_ACCESS_NOT_AUTHORIZED',
      live:false,
      requiresFallback:true,
      fallbackMode:'PUBLIC_GSA_EVIDENCE_PLUS_RECENT_COMPARABLE_AWARD_HISTORY',
      reason:!authorized ? 'AUTHORIZED_EBUY_ACCESS_REQUIRED' : (!evidence ? 'ACCESS_EVIDENCE_REQUIRED' : 'OUTSIDE_GRANTED_SCOPE')
    };
  }
}

module.exports = new GsaEbuyAccessPolicyService();
module.exports.GsaEbuyAccessPolicyService = GsaEbuyAccessPolicyService;
