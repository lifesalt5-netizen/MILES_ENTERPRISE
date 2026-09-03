'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const browser = require('../CORE/BROWSER/BrowserManager');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'DATA', 'operational_acceptance');
const OUT_FILE = path.join(OUT_DIR, 'latest_p2gc_calendly_reminder_acceptance.json');
const TARGET_SCHEDULING_URI = String(process.env.MILES_P2GC_CALENDLY_URL || 'https://calendly.com/kevin-pathways2gc/30min').replace(/\/$/, '');
const EXECUTE = process.argv.includes('--execute');

function clean(v) { return String(v == null ? '' : v).trim(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function writeEvidence(payload) {
  fs.mkdirSync(OUT_DIR, { recursive:true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
}
function fail(code, extra = {}) {
  const payload = { ok:false, status:code, targetSchedulingUri:TARGET_SCHEDULING_URI, execute:EXECUTE, checkedAt:new Date().toISOString(), ...extra };
  writeEvidence(payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
  return payload;
}
async function calendlyGet(pathname, params = {}) {
  const token = clean(process.env.CALENDLY_PERSONAL_ACCESS_TOKEN);
  if (!token) throw new Error('CALENDLY_PERSONAL_ACCESS_TOKEN_NOT_CONFIGURED');
  const url = new URL(pathname, 'https://api.calendly.com');
  Object.entries(params).forEach(([k,v]) => { if (v != null && v !== '') url.searchParams.set(k, String(v)); });
  const response = await fetch(url, { headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`CALENDLY_API_${response.status}`);
  return body;
}
async function findTargetEventType() {
  const me = await calendlyGet('/users/me');
  const user = me?.resource?.uri;
  if (!user) throw new Error('CALENDLY_USER_URI_UNAVAILABLE');
  const body = await calendlyGet('/event_types', { user, active:true, count:100, sort:'name:asc' });
  const events = Array.isArray(body?.collection) ? body.collection : [];
  const target = events.find(x => clean(x?.scheduling_uri).replace(/\/$/,'') === TARGET_SCHEDULING_URI)
    || events.find(x => clean(x?.scheduling_uri).replace(/\/$/,'').endsWith('/30min'));
  return { user, events, target };
}
async function textSnapshot(page) {
  return clean(await page.locator('body').innerText({ timeout:15000 }).catch(() => '')).slice(0,12000);
}
async function clickFirst(page, labels) {
  for (const label of labels) {
    const byRole = page.getByRole('button', { name:new RegExp(label, 'i') }).first();
    if (await byRole.count().catch(() => 0)) {
      try { await byRole.click({ timeout:5000 }); return { clicked:true, label }; } catch {}
    }
    const link = page.getByRole('link', { name:new RegExp(label, 'i') }).first();
    if (await link.count().catch(() => 0)) {
      try { await link.click({ timeout:5000 }); return { clicked:true, label }; } catch {}
    }
    const text = page.getByText(new RegExp(label, 'i')).first();
    if (await text.count().catch(() => 0)) {
      try { await text.click({ timeout:5000 }); return { clicked:true, label }; } catch {}
    }
  }
  return { clicked:false };
}
function hasImmediateConfirmation(text) {
  return /(email confirmation|confirmation email|calendar invitation|calendar invite|booking confirmation|send.*confirmation)/i.test(text);
}
function has24HourReminder(text) {
  return /(24\s*hours?|1\s*day)\s*(before|prior)|remind[^\n]{0,80}(24\s*hours?|1\s*day)|(24\s*hours?|1\s*day)[^\n]{0,80}remind/i.test(text);
}
async function add24HourReminder(page) {
  const add = await clickFirst(page, ['Add reminder','Add email reminder','Email reminder','Add workflow','Create workflow']);
  if (!add.clicked) return { ok:false, reason:'ADD_REMINDER_CONTROL_NOT_FOUND' };
  await sleep(800);

  const body = await textSnapshot(page);
  const emailChoice = await clickFirst(page, ['Email to invitee','Send email','Email reminder']);
  if (emailChoice.clicked) await sleep(500);

  const numberInput = page.locator('input[type="number"]').first();
  if (await numberInput.count().catch(() => 0)) {
    await numberInput.fill('24').catch(() => {});
  }
  const unit = page.locator('select').first();
  if (await unit.count().catch(() => 0)) {
    await unit.selectOption({ label:/hour/i }).catch(async () => {
      await unit.selectOption('hours').catch(() => {});
    });
  } else {
    await clickFirst(page, ['hours','hour']);
  }
  await clickFirst(page, ['before event starts','before event','before']);

  const save = await clickFirst(page, ['Save','Done','Apply']);
  if (!save.clicked) return { ok:false, reason:'SAVE_CONTROL_NOT_FOUND', bodyPreview:body.slice(0,3000) };
  await sleep(1200);
  return { ok:true };
}

async function main() {
  let discovery;
  try { discovery = await findTargetEventType(); }
  catch (error) { return fail('CALENDLY_API_DISCOVERY_FAILED', { error:error.message }); }
  if (!discovery.target) {
    return fail('P2GC_CALENDLY_EVENT_TYPE_NOT_FOUND', {
      activeEventTypes:discovery.events.map(x => ({ name:x.name, scheduling_uri:x.scheduling_uri, uri:x.uri }))
    });
  }

  const uuid = clean(discovery.target.uri).split('/').pop();
  const candidateUrls = [
    `https://calendly.com/app/event_types/${encodeURIComponent(uuid)}/edit`,
    `https://calendly.com/app/event_types/${encodeURIComponent(uuid)}`,
    'https://calendly.com/app/event_types/user/me'
  ];

  let page = null;
  let openedUrl = null;
  try {
    for (const url of candidateUrls) {
      await browser.openSystem('calendly-reminders', url, { headless:false });
      page = browser.pages['calendly-reminders'];
      await sleep(1500);
      const current = page?.url?.() || '';
      if (/login|sign[_-]?in/i.test(current)) return fail('CALENDLY_BROWSER_AUTH_REQUIRED', { currentUrl:current });
      const text = await textSnapshot(page);
      if (/notifications|workflow|reminder|event type|when event starts/i.test(text)) { openedUrl=current; break; }
    }
    if (!page) return fail('CALENDLY_BROWSER_PAGE_UNAVAILABLE');

    let text = await textSnapshot(page);
    if (!/notification|workflow|reminder/i.test(text)) {
      const nav = await clickFirst(page, ['Notifications and workflows','Notifications','Workflows']);
      if (nav.clicked) { await sleep(1200); text = await textSnapshot(page); }
    } else if (/notifications and workflows/i.test(text)) {
      const nav = await clickFirst(page, ['Notifications and workflows']);
      if (nav.clicked) { await sleep(1200); text = await textSnapshot(page); }
    }

    const immediateBefore = hasImmediateConfirmation(text);
    const reminder24Before = has24HourReminder(text);
    const changes = [];

    // Calendly's standard booking confirmation/calendar invitation is the immediate notification.
    // We do not disable or replace an existing confirmation method; we only fail closed if none is visible.
    if (!immediateBefore) {
      if (!EXECUTE) {
        return fail('IMMEDIATE_CONFIRMATION_NOT_VERIFIED', { eventType:{ name:discovery.target.name, scheduling_uri:discovery.target.scheduling_uri }, openedUrl, bodyPreview:text.slice(0,5000) });
      }
      const confirmation = await clickFirst(page, ['Email confirmation','Calendar invitation','Booking confirmation']);
      if (!confirmation.clicked) {
        return fail('IMMEDIATE_CONFIRMATION_CONTROL_NOT_FOUND', { eventType:{ name:discovery.target.name, scheduling_uri:discovery.target.scheduling_uri }, openedUrl, bodyPreview:text.slice(0,5000) });
      }
      await clickFirst(page, ['Enable','Turn on','Save','Done']);
      changes.push('IMMEDIATE_CONFIRMATION_ENABLED');
      await sleep(900);
      text = await textSnapshot(page);
    }

    if (!reminder24Before) {
      if (!EXECUTE) {
        return fail('TWENTY_FOUR_HOUR_REMINDER_MISSING', { eventType:{ name:discovery.target.name, scheduling_uri:discovery.target.scheduling_uri }, immediateConfirmationVerified:hasImmediateConfirmation(text), openedUrl, bodyPreview:text.slice(0,5000) });
      }
      const added = await add24HourReminder(page);
      if (!added.ok) return fail('TWENTY_FOUR_HOUR_REMINDER_CONFIGURATION_FAILED', { eventType:{ name:discovery.target.name, scheduling_uri:discovery.target.scheduling_uri }, openedUrl, details:added });
      changes.push('TWENTY_FOUR_HOUR_REMINDER_ENABLED');
      text = await textSnapshot(page);
    }

    const result = {
      ok:hasImmediateConfirmation(text) && has24HourReminder(text),
      status:hasImmediateConfirmation(text) && has24HourReminder(text) ? 'P2GC_CALENDLY_REMINDER_POLICY_GREEN' : 'P2GC_CALENDLY_REMINDER_POLICY_REVERIFY_REQUIRED',
      targetSchedulingUri:TARGET_SCHEDULING_URI,
      eventType:{ name:discovery.target.name, uri:discovery.target.uri, scheduling_uri:discovery.target.scheduling_uri },
      policy:{ immediateConfirmation:true, reminder24HoursBefore:true },
      verified:{ immediateConfirmation:hasImmediateConfirmation(text), reminder24HoursBefore:has24HourReminder(text) },
      changes,
      openedUrl,
      execute:EXECUTE,
      checkedAt:new Date().toISOString()
    };
    writeEvidence(result);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode=2;
    return result;
  } catch (error) {
    return fail('CALENDLY_REMINDER_ENFORCEMENT_ERROR', { error:error.stack || error.message, openedUrl });
  } finally {
    try { await browser.close(); } catch {}
  }
}

main();
