'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const instantly = require('../CONNECTORS/INSTANTLY/instantly');

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT = path.join(ROOT, 'DATA', 'operational_acceptance', 'campaign_schedule_governance', 'INSTANTLY_CAMPAIGN_SCHEDULE_GOVERNANCE_LATEST.json');

// Instantly API uses America/Detroit for Eastern Time in the campaign schedule enum.
const REQUIRED_TZ = 'America/Detroit';
const EARLIEST_ALLOWED = '08:00';
const LATEST_ALLOWED = '18:00';
// Instantly's documented schedule example uses 0-4 enabled and 5-6 disabled.
const WEEKDAYS = { '0': true, '1': true, '2': true, '3': true, '4': true, '5': false, '6': false };

function unwrap(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.campaigns)) return value.campaigns;
  return [];
}

function statusActive(campaign) {
  return Number(campaign?.status) === 1 || String(campaign?.status || '').toLowerCase() === 'active';
}

function scheduleRows(campaign) {
  const raw = campaign?.campaign_schedule?.schedules;
  return Array.isArray(raw) ? raw : [];
}

function hhmmMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function daysMatch(days = {}) {
  return Object.keys(WEEKDAYS).every(k => Boolean(days?.[k]) === WEEKDAYS[k]);
}

function timingInsideGovernedWindow(timing = {}) {
  const from = hhmmMinutes(timing?.from);
  const to = hhmmMinutes(timing?.to);
  const min = hhmmMinutes(EARLIEST_ALLOWED);
  const max = hhmmMinutes(LATEST_ALLOWED);
  return from !== null && to !== null && from < to && from >= min && to <= max;
}

function evaluate(campaign) {
  const schedules = scheduleRows(campaign);
  const violations = [];
  if (!schedules.length) violations.push('NO_CAMPAIGN_SCHEDULE');

  for (const s of schedules) {
    if (String(s?.timezone || '') !== REQUIRED_TZ) violations.push(`TIMEZONE:${s?.timezone || 'MISSING'}`);
    if (!timingInsideGovernedWindow(s?.timing || {})) {
      violations.push(`TIME_OUTSIDE_0800_1800:${s?.timing?.from || 'MISSING'}-${s?.timing?.to || 'MISSING'}`);
    }
    if (!daysMatch(s?.days || {})) violations.push('DAYS_NOT_WEEKDAYS_ONLY');
  }

  return {
    id: campaign?.id || null,
    name: campaign?.name || null,
    status: campaign?.status ?? null,
    emailList: Array.isArray(campaign?.email_list) ? campaign.email_list : [],
    campaignSchedule: campaign?.campaign_schedule || null,
    compliant: violations.length === 0,
    violations: [...new Set(violations)]
  };
}

async function listAllCampaigns() {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < 50; page += 1) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const resp = await instantly.listCampaigns(params);
    const items = unwrap(resp);
    out.push(...items);
    startingAfter = resp?.next_starting_after || resp?.nextStartingAfter || null;
    if (!startingAfter || items.length === 0) break;
  }
  return out;
}

async function run() {
  const campaigns = await listAllCampaigns();
  const active = campaigns.filter(statusActive);
  const evaluated = [];

  for (const summary of active) {
    const campaign = await instantly.getCampaign(summary.id);
    evaluated.push(evaluate(campaign));
  }

  const noncompliant = evaluated.filter(x => !x.compliant);

  const result = {
    ok: noncompliant.length === 0,
    gate: 'INSTANTLY_ACTIVE_CAMPAIGN_SCHEDULE_GOVERNANCE',
    generatedAt: new Date().toISOString(),
    policy: {
      timezone: REQUIRED_TZ,
      allowedTiming: { earliest: EARLIEST_ALLOWED, latest: LATEST_ALLOWED },
      weekdayPattern: WEEKDAYS,
      note: 'A narrower schedule such as 09:00-17:00 is compliant because it remains fully inside the governed 08:00-18:00 Eastern window.'
    },
    campaignsObserved: campaigns.length,
    activeCampaigns: active.length,
    compliantActiveCampaigns: evaluated.length - noncompliant.length,
    noncompliantActiveCampaigns: noncompliant.length,
    violations: noncompliant,
    evaluated,
    readOnly: true,
    instantlyMutated: false
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  result.outputFile = OUT;
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  run().then(r => { if (!r.ok) process.exitCode = 2; }).catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
}

module.exports = { run, evaluate, daysMatch, timingInsideGovernedWindow, statusActive, unwrap };
