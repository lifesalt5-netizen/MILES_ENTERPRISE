'use strict';
const fs = require('fs');
const path = require('path');
const script = fs.readFileSync(path.join(__dirname,'..','SCRIPTS','AuditOrionRefreshTargetSchema.js'),'utf8');
if (!script.includes("TARGETS = ['contractors','buyers','opportunities','recompetes','contractor_recommendations_v2','persona_scores','contract_vehicle_health']")) throw new Error('TARGET_TABLES_MISSING');
if (!script.includes('productionDatabaseModified: false')) throw new Error('PRODUCTION_SAFETY_MARKER_MISSING');
if (!script.includes("DESIGN_PARTIAL_STAGING_REFRESH_WITH_EXPLICIT_SOURCE_PROVENANCE")) throw new Error('NEXT_STEP_MARKER_MISSING');
console.log('ORION_REFRESH_TARGET_SCHEMA_AUDIT_SMOKE_PASS');
