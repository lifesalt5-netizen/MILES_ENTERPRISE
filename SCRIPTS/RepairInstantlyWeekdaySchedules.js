'use strict';

const fs = require('fs');
const path = require('path');

function parse(argv) {
  const rootArg = argv.find(v => v.startsWith('--root='));
  return {
    rootDir: path.resolve(rootArg ? rootArg.slice(7) : process.env.MILES_ROOT || process.cwd()),
    execute: argv.includes('--execute')
  };
}

function unwrap(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.campaigns)) return value.campaigns;
  return [];
}

function active(campaign) {
  return Number(campaign?.status) === 1 || String(campaign?.status || '').toLowerCase() === 'active';
}

// Instantly campaign schedule day indexes: 0=Sunday ... 6=Saturday.
const REQUIRED_DAYS = { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false };

function daysMatch(days = {}) {
  return Object.keys(REQUIRED_DAYS).every(k => Boolean(days?.[k]) === REQUIRED_DAYS[k]);
}

function repairedSchedule(campaignSchedule = {}) {
  const schedules = Array.isArray(campaignSchedule?.schedules) ? campaignSchedule.schedules : [];
  return {
    ...campaignSchedule,
    schedules: schedules.map(s => ({ ...s, days: { ...REQUIRED_DAYS } }))
  };
}

async function listAll(instantly) {
  const rows = [];
  let startingAfter = null;
  for (let page = 0; page < 50; page += 1) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const resp = await instantly.listCampaigns(params);
    const items = unwrap(resp);
    rows.push(...items);
    startingAfter = resp?.next_starting_after || resp?.nextStartingAfter || null;
    if (!startingAfter || items.length === 0) break;
  }
  return rows;
}

async function main() {
  const options = parse(process.argv.slice(2));
  process.env.MILES_ROOT = options.rootDir;
  require(path.join(options.rootDir, 'node_modules', 'dotenv')).config({ path: path.join(options.rootDir, '.env'), override: false, quiet: true });

  const instantly = require(path.join(options.rootDir, 'CONNECTORS', 'INSTANTLY', 'instantly.js'));
  const campaigns = await listAll(instantly);
  const targets = [];
  const blockers = [];

  for (const summary of campaigns.filter(active)) {
    const campaign = await instantly.getCampaign(summary.id);
    const schedules = Array.isArray(campaign?.campaign_schedule?.schedules) ? campaign.campaign_schedule.schedules : [];
    if (!schedules.length) {
      blockers.push({ id: campaign?.id || summary.id, name: campaign?.name || summary.name, reason: 'NO_CAMPAIGN_SCHEDULE' });
      continue;
    }
    if (schedules.some(s => !daysMatch(s?.days || {}))) {
      targets.push({
        id: campaign.id,
        name: campaign.name,
        before: campaign.campaign_schedule,
        after: repairedSchedule(campaign.campaign_schedule)
      });
    }
  }

  const result = {
    ok: blockers.length === 0,
    mode: options.execute ? 'EXECUTE' : 'PLAN_ONLY',
    generatedAt: new Date().toISOString(),
    policy: {
      days: REQUIRED_DAYS,
      weekdayIndexMeaning: { '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' }
    },
    campaignsObserved: campaigns.length,
    activeCampaigns: campaigns.filter(active).length,
    campaignsNeedingRepair: targets.length,
    blockers,
    changes: [],
    externalMutationAttempted: false
  };

  if (options.execute) {
    const dryRun = String(process.env.MILES_DRY_RUN || 'true').toLowerCase();
    const allowed = String(process.env.MILES_ALLOW_INSTANTLY_MUTATIONS || 'false').toLowerCase();
    if (dryRun !== 'false' || allowed !== 'true') {
      throw new Error('Live repair requires MILES_DRY_RUN=false and MILES_ALLOW_INSTANTLY_MUTATIONS=true.');
    }

    result.externalMutationAttempted = targets.length > 0;
    for (const target of targets) {
      await instantly.updateCampaign(target.id, { campaign_schedule: target.after });
      const readBack = await instantly.getCampaign(target.id);
      const rows = Array.isArray(readBack?.campaign_schedule?.schedules) ? readBack.campaign_schedule.schedules : [];
      const verified = rows.length > 0 && rows.every(s => daysMatch(s?.days || {}));
      result.changes.push({
        id: target.id,
        name: target.name,
        verified,
        before: target.before,
        after: readBack?.campaign_schedule || null
      });
      if (!verified) result.ok = false;
    }
  } else {
    result.changes = targets.map(t => ({ id: t.id, name: t.name, verified: false, before: t.before, proposed: t.after }));
  }

  const outDir = path.join(options.rootDir, 'DATA', 'operational_acceptance', 'campaign_schedule_governance');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'INSTANTLY_WEEKDAY_REPAIR_LATEST.json');
  result.outputFile = out;
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}

module.exports = { REQUIRED_DAYS, daysMatch, repairedSchedule, unwrap, active };
