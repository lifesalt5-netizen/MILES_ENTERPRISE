'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
const readinessPath = path.join(ROOT, 'DATA', 'orion_refresh', 'latest_rebuild_readiness.json');
const outputPath = path.join(ROOT, 'DATA', 'orion_refresh', 'latest_refresh_target_schema_audit.json');
const TARGETS = ['contractors','buyers','opportunities','recompetes','contractor_recommendations_v2','persona_scores','contract_vehicle_health'];

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function main() {
  const readiness = readJson(readinessPath);
  const current = readiness?.current;
  if (!current?.ok || !current?.path) throw new Error('CURRENT_ORION_READINESS_NOT_GREEN');
  const allSchema = current.schema || {};
  const counts = current.counts || {};
  const tables = Array.isArray(current.tables) ? current.tables : [];
  const targets = {};
  for (const table of TARGETS) {
    targets[table] = {
      present: tables.includes(table),
      rowCount: counts[table] ?? null,
      columns: Array.isArray(allSchema[table]) ? allSchema[table] : []
    };
  }
  const awardLikeTables = tables.filter(name => /award|contract|vehicle|recompete|recipient|obligation/i.test(name));
  const result = {
    ok: true,
    service: 'ORION_REFRESH_TARGET_SCHEMA_AUDIT',
    generatedAt: new Date().toISOString(),
    currentDb: current.path,
    currentDbMtime: current.mtime || null,
    targetTables: targets,
    awardLikeTables,
    allTableNames: tables,
    nextStep: 'DESIGN_PARTIAL_STAGING_REFRESH_WITH_EXPLICIT_SOURCE_PROVENANCE',
    sourceBoundary: {
      currentlyAcquired: 'USAspending contract award archives',
      mayRefresh: ['award-history-derived facts','recompete-derived facts when derivation contract is proven'],
      mustNotClaimRefreshedWithoutSeparateCurrentSources: ['opportunities','SAM registry truth','recommendations','persona scores']
    },
    safety: {
      readOnly: true,
      productionDatabaseModified: false,
      stagingDatabaseCreated: false,
      stagingDatabasePromoted: false
    }
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

try { main(); } catch (error) {
  console.error(JSON.stringify({ ok:false, service:'ORION_REFRESH_TARGET_SCHEMA_AUDIT', error:error.message }, null, 2));
  process.exitCode = 2;
}
