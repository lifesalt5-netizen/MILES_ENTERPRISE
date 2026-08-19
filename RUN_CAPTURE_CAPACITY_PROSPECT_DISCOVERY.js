"use strict";

const fs=require("fs");
const path=require("path");
const CaptureCapacityProspectDiscoveryService=require("./SERVICES/revenue/CaptureCapacityProspectDiscoveryService");
const {CaptureCapacitySourceBootstrapService}=require("./SERVICES/revenue/CaptureCapacitySourceBootstrapService");
const {CaptureCapacityOrionSignalBridgeService}=require("./SERVICES/revenue/CaptureCapacityOrionSignalBridgeService");

function arg(name){const prefix=`--${name}=`;const hit=process.argv.find(value=>value.startsWith(prefix));return hit?hit.slice(prefix.length):null;}
function hasFlag(name){return process.argv.includes(`--${name}`);}
function splitFiles(value){return String(value||"").split(path.delimiter).map(v=>v.trim()).filter(Boolean).map(v=>path.resolve(v));}
function ensureFiles(files,label){for(const file of files)if(!fs.existsSync(file))throw new Error(`${label} source not found: ${file}`);return files;}

function prepareSources(rootDir){
 let contactBootstrap=null,signalBridge=null;
 if(!String(process.env.CAPTURE_CAPACITY_CONTACT_SOURCES||"").trim()){
  contactBootstrap=new CaptureCapacitySourceBootstrapService({rootDir,env:process.env}).apply();
 }
 if(!String(process.env.CAPTURE_CAPACITY_SIGNAL_SOURCES||"").trim()){
  signalBridge=new CaptureCapacityOrionSignalBridgeService({rootDir}).apply();
  if(signalBridge?.verifiedSignalCount>0&&signalBridge.signalFile&&fs.existsSync(signalBridge.signalFile)) process.env.CAPTURE_CAPACITY_SIGNAL_SOURCES=signalBridge.signalFile;
 }
 return {contactBootstrap,signalBridge};
}

async function main(){
 const rootDir=path.resolve(process.env.MILES_ROOT||__dirname);
 const explicitContacts=arg("contacts"),explicitSignals=arg("signals");
 if(explicitContacts)process.env.CAPTURE_CAPACITY_CONTACT_SOURCES=explicitContacts;
 if(explicitSignals)process.env.CAPTURE_CAPACITY_SIGNAL_SOURCES=explicitSignals;
 const preparation=prepareSources(rootDir);
 const contactFiles=ensureFiles(splitFiles(process.env.CAPTURE_CAPACITY_CONTACT_SOURCES),"Contact");
 const signalFiles=ensureFiles(splitFiles(process.env.CAPTURE_CAPACITY_SIGNAL_SOURCES),"Signal");
 const service=new CaptureCapacityProspectDiscoveryService({rootDir});
 const result=await service.discoverAndHandoff({contactFiles,signalFiles,handoff:!hasFlag("discovery-only"),apply:hasFlag("apply"),activate:hasFlag("activate"),activationApproval:arg("approval")||process.env.CAPTURE_CAPACITY_ACTIVATION_APPROVAL||"",dailyLimit:Number(arg("daily-limit")||process.env.CAPTURE_CAPACITY_DAILY_LIMIT||50),maxAudience:Number(arg("max-audience")||process.env.CAPTURE_CAPACITY_MAX_AUDIENCE||2000)});
 console.log(JSON.stringify({...result,sourcePreparation:preparation},null,2));
 if(!result.ok)process.exitCode=2;
}
main().catch(error=>{console.error(JSON.stringify({ok:false,status:"CAPTURE_CAPACITY_PROSPECT_DISCOVERY_FAILED",error:error.message},null,2));process.exitCode=1;});

module.exports={prepareSources};
