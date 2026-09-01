'use strict';

const fs = require('fs');
const path = require('path');
const clientPortalPolicy = require('./ClientAuthorizedPortalAccessPolicyService');

const ROOT = process.env.MILES_ROOT || process.cwd();
const POLICY_PATH = path.join(ROOT, 'CONFIG', 'UNIVERSAL_GOVERNMENT_OPPORTUNITY_INDEX_POLICY.json');

function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toUpperCase(); }

class UniversalGovernmentOpportunityIndexPolicyService {
  policy() {
    try {
      return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
    } catch {
      return {
        status:'POLICY_UNAVAILABLE',
        accessRules:{ neverBypassAuthentication:true, neverCircumventAccessControls:true }
      };
    }
  }

  classify(record = {}, context = {}) {
    const sourceAccess = norm(record.sourceAccess || context.sourceAccess);
    const stage = norm(record.stage);
    const source = norm([record.source, record.portal, record.sourceUrl, record.url].filter(Boolean).join(' '));

    const historical =
      sourceAccess === 'PUBLIC_AWARD_HISTORY' ||
      sourceAccess === 'GSA_PUBLIC_HISTORICAL_PROXY' ||
      stage === 'RECENT_SIMILAR_AWARD' ||
      /USASPENDING|AWARD HISTORY|HISTORICAL PROXY|MISSED WORK/.test(source);

    if (historical) {
      return {
        allowed:true,
        evidenceLane:'RECONSTRUCTED_INTELLIGENCE',
        badge:'RECENT AWARD / MISSED WORK',
        live:false,
        restricted:false
      };
    }

    const restricted =
      /AUTHORIZED|GATED|RESTRICTED|CONTRACT HOLDER|CONTRACT_HOLDER|CLIENT PORTAL/.test(sourceAccess) ||
      /EBUY|E GOS|EGOS|SEWP|CHESS|ECMS|PIEE/.test(source);

    if (restricted) {
      const decision = clientPortalPolicy.evaluate({
        activePayingClient:context.activePayingClient === true,
        dedicatedClientWorkspace:context.dedicatedClientWorkspace === true,
        authorizedAccess:context.authorizedAccess === true || record.authorizedAccess === true || record.authorizedEbuyAccess === true,
        accessEvidenceId:clean(context.accessEvidenceId || record.accessEvidenceId || record.authorizedAccessEvidence),
        withinGrantedScope:context.withinGrantedScope !== false && record.withinGrantedScope !== false,
        prospectDemo:context.prospectDemo === true,
        readWriteScope:context.readWriteScope || record.readWriteScope || 'READ'
      });

      return decision.allowed ? {
        allowed:true,
        evidenceLane:'AUTHORIZED_CLIENT_LIVE',
        badge:'LIVE AUTHORIZED',
        live:true,
        restricted:true,
        accessEvidenceId:decision.accessEvidenceId,
        requiresSeparateWriteGovernance:decision.requiresSeparateWriteGovernance === true
      } : {
        allowed:false,
        evidenceLane:'COVERAGE_GAP',
        badge:'GATED / COVERAGE GAP',
        live:false,
        restricted:true,
        reason:decision.reason || decision.status,
        fallbackRequired:true
      };
    }

    return {
      allowed:true,
      evidenceLane:'PUBLIC_LIVE',
      badge:stage === 'FORECAST' ? 'FORECAST' :
        (['RFI','SOURCES_SOUGHT','PRESOLICITATION','DRAFT','SPECIAL_NOTICE'].includes(stage) ? 'PRE-AWARD SIGNAL' :
          (stage === 'RECOMPETE' ? 'RECOMPETE' : 'LIVE PUBLIC')),
      live:!['FORECAST','RECOMPETE'].includes(stage),
      restricted:false
    };
  }

  prospectDemo(record = {}) {
    return this.classify(record, {
      prospectDemo:true,
      activePayingClient:false,
      dedicatedClientWorkspace:false,
      authorizedAccess:false,
      withinGrantedScope:false
    });
  }
}

module.exports = new UniversalGovernmentOpportunityIndexPolicyService();
module.exports.UniversalGovernmentOpportunityIndexPolicyService = UniversalGovernmentOpportunityIndexPolicyService;
