'use strict';

const fs = require('fs');
const path = require('path');

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
    const activePayingClient = context.activePayingClient === true;
    const dedicatedWorkspace = context.dedicatedClientWorkspace === true;
    const authorized = context.authorizedAccess === true || record.authorizedAccess === true || record.authorizedEbuyAccess === true;
    const evidenceId = clean(context.accessEvidenceId || record.accessEvidenceId || record.authorizedAccessEvidence);
    const withinScope = context.withinGrantedScope !== false && record.withinGrantedScope !== false;

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
      const permitted = activePayingClient && dedicatedWorkspace && authorized && Boolean(evidenceId) && withinScope;
      return permitted ? {
        allowed:true,
        evidenceLane:'AUTHORIZED_CLIENT_LIVE',
        badge:'LIVE AUTHORIZED',
        live:true,
        restricted:true,
        accessEvidenceId:evidenceId
      } : {
        allowed:false,
        evidenceLane:'COVERAGE_GAP',
        badge:'GATED / COVERAGE GAP',
        live:false,
        restricted:true,
        reason:!activePayingClient ? 'ACTIVE_PAYING_CLIENT_REQUIRED' :
          (!dedicatedWorkspace ? 'DEDICATED_CLIENT_WORKSPACE_REQUIRED' :
            (!authorized ? 'AUTHORIZED_ACCESS_REQUIRED' :
              (!evidenceId ? 'ACCESS_EVIDENCE_REQUIRED' : 'OUTSIDE_GRANTED_SCOPE')))
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
    const decision = this.classify(record, {
      activePayingClient:false,
      dedicatedClientWorkspace:false,
      authorizedAccess:false,
      withinGrantedScope:false
    });
    if (decision.evidenceLane === 'AUTHORIZED_CLIENT_LIVE') {
      return { ...decision, allowed:false, reason:'PROSPECT_DEMO_RESTRICTED_DATA_PROHIBITED' };
    }
    return decision;
  }
}

module.exports = new UniversalGovernmentOpportunityIndexPolicyService();
module.exports.UniversalGovernmentOpportunityIndexPolicyService = UniversalGovernmentOpportunityIndexPolicyService;
