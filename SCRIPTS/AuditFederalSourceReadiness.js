'use strict';

const fs = require('fs');
const path = require('path');
const Service = require('../SERVICES/orion/FederalSourceReadinessAuditService');
const SamEntityPublicBulkFilenameProbeFallbackService = require('../SERVICES/orion/SamEntityPublicBulkFilenameProbeFallbackService');

function persist(rootDir, result) {
  const reportPath = path.join(rootDir, 'DATA', 'orion_refresh', 'latest_federal_source_readiness.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8');
  return reportPath;
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
  const result = await new Service({ rootDir }).run();

  if (result?.samBulk?.entityRegistration?.ready !== true) {
    const fallback = await new SamEntityPublicBulkFilenameProbeFallbackService().run();
    result.samBulk.entityRegistration.filenameProbeFallback = {
      used: true,
      ok: fallback.ok === true,
      ready: fallback.ready === true,
      discoveryMethod: fallback.discoveryMethod || null,
      attempts: fallback.attempts || 0,
      blocker: fallback.blocker || null
    };
    result.safety = {
      ...(result.safety || {}),
      officialMonthlyFilenameHeadProbeUsed: true,
      officialMonthlyFilenameHeadProbeAttempts: fallback.attempts || 0,
      requestsMade: Number(result.safety?.requestsMade || 0) + Number(fallback.attempts || 0)
    };

    if (fallback.ready === true && fallback.latestFile && fallback.downloadHead?.ok === true) {
      result.samBulk.entityRegistration.discoveryMethod = fallback.discoveryMethod;
      result.samBulk.entityRegistration.latestFile = fallback.latestFile;
      result.samBulk.entityRegistration.downloadHead = fallback.downloadHead;
      result.samBulk.entityRegistration.ready = true;
      result.blockers = (Array.isArray(result.blockers) ? result.blockers : [])
        .filter(blocker => blocker !== 'SAM_ENTITY_PUBLIC_BULK_EXTRACT_NOT_DISCOVERED_OR_NOT_REACHABLE');
      result.ok = result.blockers.length === 0;
      result.nextStep = result.ok
        ? 'ACQUIRE_AND_STAGE_SAM_PUBLIC_ENTITY_AND_OPPORTUNITY_BULK_EXTRACTS'
        : 'REMEDIATE_REMAINING_FEDERAL_SOURCE_READINESS_BLOCKERS';
    }
    persist(rootDir, result);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result?.ok === true ? 0 : 2;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, service: 'FEDERAL_SOURCE_READINESS_AUDIT', error: error.message }, null, 2));
    process.exitCode = 2;
  });
}

module.exports = { main, persist };
