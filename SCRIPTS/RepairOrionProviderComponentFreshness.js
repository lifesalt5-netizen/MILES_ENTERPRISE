'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'..'); const APPLY=process.argv.includes('--apply');
const file=path.join(ROOT,'PROVIDERS','providers','OrionProvider.js');
let text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
function patch(before,after,label){
  if(text.includes(after)){console.log(`${label}=ALREADY_CURRENT`);return;}
  const count=text.split(before).length-1; if(count!==1) throw new Error(`${label}: expected one anchor, found ${count}`);
  text=text.replace(before,after); console.log(`${label}=${APPLY?'APPLIED':'DRY_RUN_OK'}`);
}
patch(
  'const defaultConnector =\n  require("../../CONNECTORS/ORION/connector");',
  'const defaultConnector =\n  require("../../CONNECTORS/ORION/connector");\nconst OrionComponentFreshnessService = require("../../SERVICES/orion/OrionComponentFreshnessService");',
  'ORION_PROVIDER_COMPONENT_FRESHNESS_IMPORT'
);
patch(
  '      const dbFreshness =\n        databaseFreshness(health.db);',
  '      const dbFreshness =\n        databaseFreshness(health.db);\n      const componentFreshness = new OrionComponentFreshnessService({ rootDir: ROOT }).run(dbFreshness);',
  'ORION_PROVIDER_COMPONENT_FRESHNESS_CALC'
);
patch(
  '          message:\n            dbFreshness.ageHours === null\n              ? "ORION database freshness could not be determined."\n              : `ORION database is ${dbFreshness.ageHours} hours old.`',
  '          message:\n            dbFreshness.ageHours === null\n              ? "ORION core database freshness could not be determined; component freshness is tracked separately."\n              : `ORION core database is ${dbFreshness.ageHours} hours old; component freshness is tracked separately and must not be inferred from database mtime.`',
  'ORION_PROVIDER_CORE_FRESHNESS_WORDING'
);
patch(
  '        databaseFreshness:\n          dbFreshness,',
  '        databaseFreshness:\n          dbFreshness,\n        componentFreshness,',
  'ORION_PROVIDER_COMPONENT_FRESHNESS_METRIC'
);
patch(
  '      if (dbFreshness.stale) {\n        this.recommendations.push(\n          "Run the authorized ORION dataset refresh and verify database modification time afterward."\n        );\n      }',
  '      if (dbFreshness.stale) {\n        this.recommendations.push(\n          componentFreshness.partialFreshness\n            ? "ORION has partial freshness: use the current contract sidecar for award-derived facts and refresh remaining source families before claiming full freshness."\n            : "Run the governed ORION source-family refresh; database modification time alone must not be used as freshness proof."\n        );\n      }',
  'ORION_PROVIDER_FRESHNESS_RECOMMENDATION'
);
patch(
  '          intelligenceJobExecuted: false\n        }',
  '          intelligenceJobExecuted: false,\n          componentFreshnessEvaluated: true,\n          databaseMtimeAloneCannotProveFullFreshness: true\n        }',
  'ORION_PROVIDER_SAFETY_FRESHNESS'
);
if(APPLY) fs.writeFileSync(file,text,'utf8');
console.log(APPLY?'ORION_PROVIDER_COMPONENT_FRESHNESS_REPAIR_APPLIED':'ORION_PROVIDER_COMPONENT_FRESHNESS_REPAIR_DRY_RUN_OK');
