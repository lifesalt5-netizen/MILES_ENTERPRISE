"use strict";
const path=require("path");
const {MonicaAcquisitionIntelligenceService}=require("../SERVICES/monica/MonicaAcquisitionIntelligenceService");
const root=process.env.MILES_ROOT || path.resolve(__dirname,"..");
try {
  const result=new MonicaAcquisitionIntelligenceService({rootDir:root}).run();
  console.log(JSON.stringify(result,null,2));
  process.exit(0);
} catch (err) {
  console.error(JSON.stringify({ok:false,error:err.message,stack:err.stack},null,2));
  process.exit(1);
}
