'use strict';

const assert = require('assert');
const { campaignSchedule, inspectCampaignSchedule, inspectSenderCapacity, GOVERNANCE } = require('../SERVICES/revenue/OutboundSendingGovernance');

function campaign(schedule, dailyLimit = 25) {
  return { campaign_schedule: schedule, daily_limit: dailyLimit };
}

const canonical = campaignSchedule('2026-08-20');
assert.strictEqual(canonical.schedules[0].timezone, 'America/New_York');
assert.deepStrictEqual(canonical.schedules[0].timing, { from:'08:00', to:'18:00' });
assert.strictEqual(inspectCampaignSchedule(campaign(canonical)).compliant, true);

const narrower = campaignSchedule();
narrower.schedules[0].timing = { from:'09:00', to:'16:30' };
assert.strictEqual(inspectCampaignSchedule(campaign(narrower)).compliant, true, 'narrower weekday window inside policy must pass');

const wrongTimezone = campaignSchedule();
wrongTimezone.schedules[0].timezone = 'America/Detroit';
assert.strictEqual(inspectCampaignSchedule(campaign(wrongTimezone)).compliant, false);

const legacyTimezone = campaignSchedule();
legacyTimezone.schedules[0].timezone = 'Etc/GMT+12';
assert.strictEqual(inspectCampaignSchedule(campaign(legacyTimezone)).compliant, false);

const early = campaignSchedule();
early.schedules[0].timing.from = '07:59';
assert.ok(inspectCampaignSchedule(campaign(early)).violations.includes('SCHEDULE_0_START_BEFORE_08_00'));

const late = campaignSchedule();
late.schedules[0].timing.to = '18:01';
assert.ok(inspectCampaignSchedule(campaign(late)).violations.includes('SCHEDULE_0_STOP_AFTER_18_00'));

const weekend = campaignSchedule();
weekend.schedules[0].days['5'] = true;
assert.ok(inspectCampaignSchedule(campaign(weekend)).violations.includes('SCHEDULE_0_SATURDAY_ENABLED'));

const layered = campaignSchedule();
layered.schedules.push({ name:'bad-extra-layer', timing:{from:'06:00',to:'20:00'}, days:{'0':true,'1':true,'2':true,'3':true,'4':true,'5':true,'6':false}, timezone:'UTC' });
assert.strictEqual(inspectCampaignSchedule(campaign(layered)).compliant, false, 'every schedule layer must be safe');

assert.strictEqual(inspectSenderCapacity({daily_limit:250}, 10).compliant, true);
assert.strictEqual(inspectSenderCapacity({daily_limit:251}, 10).compliant, false);
assert.strictEqual(inspectSenderCapacity({daily_limit:0}, 10).compliant, false);
assert.strictEqual(inspectSenderCapacity({daily_limit:25}, 0).compliant, false);
assert.strictEqual(GOVERNANCE.maxDailyPerInbox, 25);

console.log('OUTBOUND_SENDING_GOVERNANCE_TEST=PASS');
