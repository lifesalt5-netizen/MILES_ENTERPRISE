'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
function bool(value) { return value === true; }

class ContinuousSystemHealthPolicyService {
  evaluateLane(evidence = {}, options = {}) {
    const now = Number(options.nowMs || Date.now());
    const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || evidence.maxAgeMs || 300000));
    const observedAt = evidence.observedAt ? Date.parse(evidence.observedAt) : NaN;
    const ageMs = Number.isFinite(observedAt) ? now - observedAt : null;
    const evidenceFresh = ageMs != null && ageMs >= 0 && ageMs <= maxAgeMs;
    const functionalProbe = bool(evidence.functionalProbe);
    const semanticResult = bool(evidence.semanticResult);
    const dependencyStatus = evidence.dependencyRequired === false ? true : bool(evidence.dependencyStatus);
    const freshnessStatus = evidence.freshnessRequired === false ? true : bool(evidence.freshnessStatus);
    const green = evidenceFresh && functionalProbe && semanticResult && dependencyStatus && freshnessStatus;

    const reasons = [];
    if (!evidenceFresh) reasons.push(ageMs == null ? 'EVIDENCE_TIMESTAMP_MISSING_OR_INVALID' : 'EVIDENCE_STALE');
    if (!functionalProbe) reasons.push('FUNCTIONAL_PROBE_FAILED_OR_MISSING');
    if (!semanticResult) reasons.push('SEMANTIC_RESULT_FAILED_OR_MISSING');
    if (!dependencyStatus) reasons.push('DEPENDENCY_FAILED_OR_MISSING');
    if (!freshnessStatus) reasons.push('DATA_FRESHNESS_FAILED_OR_MISSING');

    return {
      lane:clean(evidence.lane || options.lane) || null,
      state:green ? 'GREEN' : 'RED',
      green,
      observedAt:evidence.observedAt || null,
      ageMs,
      maxAgeMs,
      processOnline:bool(evidence.processOnline),
      functionalProbe,
      semanticResult,
      dependencyStatus,
      freshnessStatus,
      recoveryAttempted:bool(evidence.recoveryAttempted),
      recoveryResult:evidence.recoveryResult || null,
      reasons,
      rule:'PROCESS_ONLINE_OR_HTTP_200_ALONE_NEVER_QUALIFIES_AS_GREEN'
    };
  }

  evaluateSystem(lanes = [], options = {}) {
    const results = (Array.isArray(lanes) ? lanes : []).map(lane => this.evaluateLane(lane, options));
    const red = results.filter(row => !row.green);
    return {
      ok:red.length === 0 && results.length > 0,
      state:red.length === 0 && results.length > 0 ? 'GREEN' : 'RED',
      total:results.length,
      green:results.length - red.length,
      red:red.length,
      lanes:results,
      checkedAt:new Date(Number(options.nowMs || Date.now())).toISOString()
    };
  }
}

module.exports = new ContinuousSystemHealthPolicyService();
module.exports.ContinuousSystemHealthPolicyService = ContinuousSystemHealthPolicyService;
