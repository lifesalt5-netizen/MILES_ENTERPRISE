'use strict';

const planner = require('./CommandIntentPlannerService');

const PATCH_FLAG = Symbol.for('MILES_GOVDATA_ROUTING_OVERRIDE_APPLIED');

function isGovernmentDataMission(text) {
  return /\b(gsa|sam\.?gov|sam registration|usaspending|usa spending|government data|gsa holder|gsa holders|schedule holder|schedule holders|sin master|vendor universe|vendor ingest|vendor refresh|vendor reconciliation)\b/i.test(text) &&
    /\b(refresh|reconcile|reconciliation|ingest|pull|harvest|vendor|vendors|holder|holders|dataset|data|sales|award|awards|segment|segmenting|segmentation)\b/i.test(text);
}

function isSpecificWebsiteReview(text) {
  return /review website|website review|check website|website health|audit website|website audit/i.test(text);
}

function applyOverride(target = planner) {
  if (!target || target[PATCH_FLAG]) return target;

  const originalResolveIntent = target.resolveIntent.bind(target);
  const originalResolveWorkflow = target.resolveWorkflow.bind(target);

  target.resolveIntent = function resolveIntentWithGovernmentDataPrecedence(text, operation = {}) {
    if (!operation.intent && isGovernmentDataMission(String(text || ''))) {
      return 'EXECUTIVE_MISSION';
    }
    return originalResolveIntent(text, operation);
  };

  target.resolveWorkflow = function resolveWorkflowWithNarrowWebsiteRouting(text, intent, operation = {}) {
    const normalized = String(text || '').toLowerCase();
    if (!operation.workflow && intent === 'BUSINESS_OPERATION' && /website/.test(normalized) && !isSpecificWebsiteReview(normalized)) {
      if (/instantly|campaign|deliverability|bounce|warmup|reply|replies/.test(normalized)) return 'INSTANTLY_LIVE_REVIEW';
      if (/linkedin/.test(normalized)) return 'LINKEDIN_REVIEW';
      if (/google|gmail|workspace|calendar|drive/.test(normalized)) return 'GOOGLE_WORKSPACE_REVIEW';
      return 'BUSINESS_REVIEW';
    }
    return originalResolveWorkflow(text, intent, operation);
  };

  Object.defineProperty(target, PATCH_FLAG, { value: true, enumerable: false, configurable: false });
  return target;
}

module.exports = applyOverride();
module.exports.applyOverride = applyOverride;
module.exports.isGovernmentDataMission = isGovernmentDataMission;
module.exports.isSpecificWebsiteReview = isSpecificWebsiteReview;
