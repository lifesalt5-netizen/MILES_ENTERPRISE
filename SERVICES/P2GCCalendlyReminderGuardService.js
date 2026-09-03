'use strict';

const fs = require('fs');
const path = require('path');
const calendly = require('../CONNECTORS/CALENDLY/connector');
const gmail = require('../CONNECTORS/GOOGLE/gmail');

const TARGET_EVENT_TYPE_UUID = String(process.env.MILES_P2GC_CALENDLY_EVENT_TYPE_UUID || 'f3d1c97c-717f-4d20-aca6-18771349fb4d').trim();
const TARGET_EVENT_NAME = /FEDERAL\s+STRATEGY\s+CALL.*PATHWAYS\s+2\s+GOV(?:ERNMENT|'?T)?\s+CONTRACTING/i;
const SENDER = String(process.env.MILES_P2GC_MEETING_SENDER || 'kevin@pathways2gc.com').trim().toLowerCase();
const REMINDER_WINDOW_MINUTES = Math.max(5, Number(process.env.MILES_P2GC_24H_REMINDER_WINDOW_MINUTES || 10));

function clean(v){ return String(v == null ? '' : v).trim(); }
function eventUuid(uri){ const m=clean(uri).match(/\/event_types\/([^/?#]+)/i); return m ? m[1] : null; }
function scheduledEventUuid(uri){ const m=clean(uri).match(/\/scheduled_events\/([^/?#]+)/i); return m ? m[1] : null; }
function safeKey(v){ return clean(v).toLowerCase().replace(/[^a-z0-9._-]+/g,'_'); }
function minutesBetween(a,b){ return (new Date(a).getTime()-new Date(b).getTime())/60000; }
function isValidDate(v){ return Number.isFinite(Date.parse(v || '')); }

class P2GCCalendlyReminderGuardService {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname,'..'));
    this.stateFile=path.join(this.rootDir,'DATA','runtime','p2gc_calendly_reminder_guard_state.json');
    this.evidenceFile=path.join(this.rootDir,'DATA','operational_acceptance','latest_p2gc_calendly_reminder_guard.json');
    this.now=typeof options.now==='function' ? options.now : () => new Date();
    this.calendly=options.calendly || calendly;
    this.gmail=options.gmail || gmail;
  }

  readState(){
    try { return JSON.parse(fs.readFileSync(this.stateFile,'utf8').replace(/^\uFEFF/,'')); }
    catch { return { version:2, records:{} }; }
  }
  writeJsonAtomic(file,value){
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8');
    try { fs.renameSync(tmp,file); }
    catch { fs.copyFileSync(tmp,file); try{fs.unlinkSync(tmp);}catch{} }
  }
  writeState(state){ this.writeJsonAtomic(this.stateFile,state); }
  writeEvidence(result){ this.writeJsonAtomic(this.evidenceFile,result); }

  isTargetEvent(event){
    return eventUuid(event?.event_type)===TARGET_EVENT_TYPE_UUID || TARGET_EVENT_NAME.test(clean(event?.name));
  }
  recordKey(event,invitee){
    return `${scheduledEventUuid(event?.uri)||safeKey(event?.uri)}::${safeKey(invitee?.email)}`;
  }
  formatWhen(startTime,timeZone){
    const zone=clean(timeZone)||'America/New_York';
    try {
      return new Intl.DateTimeFormat('en-US',{ timeZone:zone, weekday:'long', month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' }).format(new Date(startTime));
    } catch {
      return new Intl.DateTimeFormat('en-US',{ timeZone:'America/New_York', weekday:'long', month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' }).format(new Date(startTime));
    }
  }
  reminderMessage(event,invitee){
    const when=this.formatWhen(event.start_time,invitee?.timezone);
    return {
      subject:'Reminder: Federal Strategy Call tomorrow — Pathways 2 Government Contracting',
      text:[
        `Hi ${clean(invitee?.name)||'there'},`,
        '',
        'A quick reminder that your Federal Strategy Call with Pathways 2 Government Contracting is coming up tomorrow.',
        '',
        `Scheduled for: ${when}`,
        clean(invitee?.reschedule_url) ? `Reschedule: ${invitee.reschedule_url}` : null,
        clean(invitee?.cancel_url) ? `Cancel: ${invitee.cancel_url}` : null,
        '',
        'If there is anything specific you want Kevin to address, you can reply directly to this email.',
        '',
        'Kevin Chace',
        'Pathways 2 Government Contracting'
      ].filter(v=>v!==null).join('\n')
    };
  }

  async sendReminder(event,invitee){
    const message=this.reminderMessage(event,invitee);
    return this.gmail.sendEmail({ account:SENDER, from:SENDER, replyTo:SENDER, to:invitee.email, subject:message.subject, text:message.text });
  }

  async runOnce(){
    const now=this.now();
    const nowIso=now.toISOString();
    const state=this.readState();
    state.version=2;
    state.records=state.records && typeof state.records==='object' ? state.records : {};
    const actions=[];
    const failures=[];

    let user;
    try { user=await this.calendly.getCurrentUser(); }
    catch(error){
      const result={ok:false,status:'CALENDLY_CURRENT_USER_FAILED',error:error.message,generatedAt:nowIso,actions,failures:[error.message]};
      this.writeEvidence(result); return result;
    }
    if(!user?.uri){
      const result={ok:false,status:'CALENDLY_USER_URI_UNAVAILABLE',generatedAt:nowIso,actions,failures:['CALENDLY_USER_URI_UNAVAILABLE']};
      this.writeEvidence(result); return result;
    }

    const minStart=new Date(now.getTime()-15*60000).toISOString();
    const maxStart=new Date(now.getTime()+31*24*60*60000).toISOString();
    let events=[];
    try {
      events=await this.calendly.listScheduledEvents({ user:user.uri, status:'active', minStartTime:minStart, maxStartTime:maxStart, sort:'start_time:asc', count:100, maxPages:5 });
    } catch(error){
      const result={ok:false,status:'CALENDLY_EVENT_LIST_FAILED',error:error.message,generatedAt:nowIso,actions,failures:[error.message]};
      this.writeEvidence(result); return result;
    }

    const targets=events.filter(e=>this.isTargetEvent(e));
    for(const event of targets){
      let invitees=[];
      try { invitees=await this.calendly.listEventInvitees(event.uri,{count:100,maxPages:2,sort:'created_at:desc'}); }
      catch(error){ failures.push(`INVITEE_LIST:${scheduledEventUuid(event.uri)||event.uri}:${error.message}`); continue; }
      for(const invitee of invitees){
        if(!invitee?.email || /cancel/i.test(clean(invitee?.status))) continue;
        const key=this.recordKey(event,invitee);
        const record=state.records[key] || { eventUri:event.uri, eventType:event.event_type, inviteeEmail:invitee.email, inviteeName:invitee.name||null, firstSeenAt:nowIso };
        const createdAt=isValidDate(invitee.created_at) ? invitee.created_at : record.firstSeenAt;
        const untilStartMinutes=minutesBetween(event.start_time,nowIso);

        // Calendly itself owns the immediate booking confirmation/calendar invitation. MILES
        // records that provider responsibility instead of sending a second immediate email.
        if(!record.immediateConfirmationProvider){
          record.immediateConfirmationProvider='CALENDLY_NATIVE_BOOKING_CONFIRMATION';
          record.immediateConfirmationObservedFromBookingAt=createdAt;
        }

        const bookedInside24h = isValidDate(createdAt) && minutesBetween(event.start_time,createdAt) < 24*60;
        const in24hWindow = untilStartMinutes>0 && untilStartMinutes <= 24*60 && untilStartMinutes >= (24*60-REMINDER_WINDOW_MINUTES);
        if(!record.reminder24hSentAt && in24hWindow){
          try {
            const sent=await this.sendReminder(event,invitee);
            record.reminder24hSentAt=sent.sentAt||nowIso;
            record.reminder24hMessageId=sent.messageId||null;
            record.reminder24hMode='ON_TIME_WINDOW';
            actions.push({type:'REMINDER_24H_SENT',event:event.name,invitee:invitee.email,startTime:event.start_time,messageId:sent.messageId||null});
          } catch(error){ failures.push(`REMINDER24_SEND:${invitee.email}:${error.message}`); }
        } else if(!record.reminder24hSentAt && bookedInside24h && !record.reminder24hNotApplicableAt){
          record.reminder24hNotApplicableAt=nowIso;
          record.reminder24hNotApplicableReason='BOOKED_LESS_THAN_24_HOURS_BEFORE_START';
        }

        record.lastSeenAt=nowIso;
        record.startTime=event.start_time;
        record.status=invitee.status||event.status||'active';
        state.records[key]=record;
      }
    }

    state.lastRunAt=nowIso;
    state.sender=SENDER;
    state.targetEventTypeUuid=TARGET_EVENT_TYPE_UUID;
    this.writeState(state);
    const result={
      ok:failures.length===0,
      status:failures.length?'P2GC_CALENDLY_REMINDER_GUARD_DEGRADED':'P2GC_CALENDLY_REMINDER_GUARD_GREEN',
      generatedAt:nowIso,
      targetEventTypeUuid:TARGET_EVENT_TYPE_UUID,
      targetEventCount:targets.length,
      sender:SENDER,
      cadenceTargetSeconds:60,
      policy:{
        immediateConfirmation:{ provider:'CALENDLY_NATIVE_BOOKING_CONFIRMATION', duplicateP2GCEmailSuppressed:true },
        reminder24HoursBefore:{ provider:'MILES_GMAIL_FALLBACK', sender:SENDER, windowMinutes:REMINDER_WINDOW_MINUTES },
        duplicateSuppression:true,
        bookedInside24Hours:'CALENDLY_IMMEDIATE_CONFIRMATION_ONLY_BECAUSE_A_24H_REMINDER_IS_NO_LONGER_TEMPORALLY_POSSIBLE'
      },
      actions,
      failures
    };
    this.writeEvidence(result);
    return result;
  }
}

module.exports=P2GCCalendlyReminderGuardService;
module.exports.constants={TARGET_EVENT_TYPE_UUID,SENDER,REMINDER_WINDOW_MINUTES};
