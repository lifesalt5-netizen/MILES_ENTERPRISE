'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'..'); const APPLY=process.argv.includes('--apply');
const file=path.join(ROOT,'CONNECTORS','ORION','connector.js');
let text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
function patch(before,after,label){if(text.includes(after)){console.log(`${label}=ALREADY_CURRENT`);return;} const count=text.split(before).length-1; if(count!==1) throw new Error(`${label}: expected one anchor, found ${count}`); text=text.replace(before,after); console.log(`${label}=${APPLY?'APPLIED':'DRY_RUN_OK'}`);}
patch(
  'const DB_NAME = "ORION_DEMO_LIVE_READY.db";',
  'const DB_NAME = "ORION_DEMO_LIVE_READY.db";\nconst OrionSidecarOverlayService = require("../../SERVICES/orion/OrionSidecarOverlayService");',
  'ORION_CONNECTOR_SIDECAR_IMPORT'
);
patch(
  '        this.supportedActions = [...ORION_ACTIONS];',
  '        this.supportedActions = [...ORION_ACTIONS];\n        this.sidecar = new OrionSidecarOverlayService({ rootDir: process.env.MILES_ROOT || process.cwd() });',
  'ORION_CONNECTOR_SIDECAR_CONSTRUCTOR'
);
patch(
  '            supportedActions: [...ORION_ACTIONS],\n            checkedAt: new Date().toISOString()',
  '            supportedActions: [...ORION_ACTIONS],\n            sidecar: this.sidecar.status(),\n            checkedAt: new Date().toISOString()',
  'ORION_CONNECTOR_HEALTH_SIDECAR'
);
patch(
  '            personas: this.getTableCount("persona_scores")\n        };',
  '            personas: this.getTableCount("persona_scores"),\n            contractSidecar: this.sidecar.status()\n        };',
  'ORION_CONNECTOR_SUMMARY_SIDECAR'
);
patch(
  '    getContractors(limit = 100, offset = 0) {\n        return this.getRows("contractors", limit, offset);\n    }',
  '    getContractors(limit = 100, offset = 0) {\n        return this.sidecar.enrichContractors(this.getRows("contractors", limit, offset));\n    }',
  'ORION_CONNECTOR_CONTRACTOR_OVERLAY'
);
patch(
  '    shutdown() {\n        if (this.db) {',
  '    shutdown() {\n        this.sidecar.close();\n        if (this.db) {',
  'ORION_CONNECTOR_SIDECAR_SHUTDOWN'
);
if(APPLY)fs.writeFileSync(file,text,'utf8');
console.log(APPLY?'ORION_CONNECTOR_SIDECAR_OVERLAY_REPAIR_APPLIED':'ORION_CONNECTOR_SIDECAR_OVERLAY_REPAIR_DRY_RUN_OK');
