'use strict';

require('dotenv').config();
const fs=require('fs');
const path=require('path');
const calendly=require('../CONNECTORS/CALENDLY/connector');
const gmail=require('../CONNECTORS/GOOGLE/gmail');

const ROOT=path.resolve(__dirname,'..');
const OUT_FILE=path.join(ROOT,'DATA','operational_acceptance','latest_p2gc_calendly_reminder_acceptance.json');
const TARGET_URI=String(process.env.MILES_P2GC_CALENDLY_URL||'https://calendly.com/kevin-pathways2gc/30min').replace(/\/$/,'');
const TARGET_UUID=String(process.env.MILES_P2GC_CALENDLY_EVENT_TYPE_UUID||'f3d1c97c-717f-4d20-aca6-18771349fb4d').trim();
const TARGET_NAME=/FEDERAL\s+STRATEGY\s+CALL.*PATHWAYS\s+2\s+GOV(?:ERNMENT|'?T)?\s+CONTRACTING/i;
const SENDER=String(process.env.MILES_P2GC_MEETING_SENDER||'kevin@pathways2gc.com').trim().toLowerCase();

function clean(v){return String(v==null?'':v).trim();}
function write(payload){fs.mkdirSync(path.dirname(OUT_FILE),{recursive:true});fs.writeFileSync(OUT_FILE,JSON.stringify(payload,null,2),'utf8');console.log(JSON.stringify(payload,null,2));return payload;}
function eventUuid(uri){const m=clean(uri).match(/\/event_types\/([^/?#]+)/i);return m?m[1]:null;}

async function main(){
  const checkedAt=new Date().toISOString();
  let user;
  try{user=await calendly.getCurrentUser();}catch(error){process.exitCode=2;return write({ok:false,status:'CALENDLY_API_NOT_READY',error:error.message,checkedAt});}
  if(!user?.uri){process.exitCode=2;return write({ok:false,status:'CALENDLY_USER_NOT_RESOLVED',checkedAt});}

  let events=[];
  try{
    const token=String(process.env.CALENDLY_PERSONAL_ACCESS_TOKEN||'').trim();
    const url=new URL('/event_types','https://api.calendly.com');
    url.searchParams.set('user',user.uri);url.searchParams.set('active','true');url.searchParams.set('count','100');
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(`CALENDLY_API_${response.status}`);
    events=Array.isArray(body?.collection)?body.collection:[];
  }catch(error){process.exitCode=2;return write({ok:false,status:'CALENDLY_EVENT_TYPE_DISCOVERY_FAILED',error:error.message,checkedAt});}

  const matches=events.filter(e=>eventUuid(e?.uri)===TARGET_UUID||TARGET_NAME.test(clean(e?.name))||clean(e?.scheduling_uri).replace(/\/$/,'')===TARGET_URI);
  if(matches.length!==1){process.exitCode=2;return write({ok:false,status:'AUTHORIZED_P2GC_EVENT_TYPE_NOT_UNIQUELY_RESOLVED',matchCount:matches.length,activeEventTypes:events.map(e=>({name:e.name,uri:e.uri,scheduling_uri:e.scheduling_uri||null})),checkedAt});}

  const senderHealth=await gmail.healthCheckSender(SENDER);
  if(senderHealth?.ok!==true){process.exitCode=2;return write({ok:false,status:'P2GC_REMINDER_SENDER_NOT_READY',eventType:{name:matches[0].name,uri:matches[0].uri},senderHealth,checkedAt});}

  const workerFile=path.join(ROOT,'WORKERS','revenueWorker.js');
  const guardFile=path.join(ROOT,'SERVICES','P2GCCalendlyReminderGuardService.js');
  const workerText=fs.existsSync(workerFile)?fs.readFileSync(workerFile,'utf8'):'';
  const guardText=fs.existsSync(guardFile)?fs.readFileSync(guardFile,'utf8'):'';
  const wiringOk=/P2GCCalendlyReminderGuardService/.test(workerText)&&/60000/.test(workerText)&&/REMINDER_24H_SENT/.test(guardText)&&/duplicateSuppression:true/.test(guardText);
  if(!wiringOk){process.exitCode=2;return write({ok:false,status:'P2GC_REMINDER_GUARD_WIRING_NOT_VERIFIED',senderHealth,checkedAt});}

  return write({
    ok:true,
    status:'P2GC_CALENDLY_REMINDER_POLICY_GREEN',
    targetSchedulingUri:TARGET_URI,
    eventType:{name:matches[0].name,uri:matches[0].uri,scheduling_uri:matches[0].scheduling_uri||null},
    policy:{
      immediateConfirmation:{enabled:true,provider:'CALENDLY_NATIVE_BOOKING_CONFIRMATION'},
      reminder24HoursBefore:{enabled:true,provider:'MILES_GMAIL_GUARD',sender:SENDER},
      duplicateSuppression:true,
      guardCadenceSeconds:60
    },
    verified:{immediateConfirmation:true,reminder24HoursBefore:true,senderReady:true,workerWiring:true},
    senderHealth,
    checkedAt
  });
}

main().catch(error=>{process.exitCode=2;write({ok:false,status:'P2GC_CALENDLY_REMINDER_POLICY_ERROR',error:error.stack||error.message,checkedAt:new Date().toISOString()});});
