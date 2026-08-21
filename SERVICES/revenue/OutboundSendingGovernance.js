'use strict';

const GOVERNANCE = Object.freeze({
  timezone: 'America/New_York',
  from: '08:00',
  to: '18:00',
  days: Object.freeze({ '0': true, '1': true, '2': true, '3': true, '4': true, '5': false, '6': false }),
  maxDailyPerInbox: 25
});

function campaignSchedule(startDate) {
  const schedule = {
    schedules: [{
      name: 'P2GC Weekdays Eastern',
      timing: { from: GOVERNANCE.from, to: GOVERNANCE.to },
      days: { ...GOVERNANCE.days },
      timezone: GOVERNANCE.timezone
    }]
  };
  if (startDate) schedule.start_date = String(startDate).slice(0, 10);
  return schedule;
}

function normalizeTime(value) {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
}

function inspectCampaignSchedule(campaign = {}) {
  const envelope = campaign.campaign_schedule || campaign.campaignSchedule || {};
  const schedules = Array.isArray(envelope.schedules) ? envelope.schedules : [];
  const violations = [];

  if (!schedules.length) violations.push('SCHEDULE_NOT_PRESENT');

  schedules.forEach((schedule, index) => {
    const timezone = String(schedule?.timezone || '').trim();
    const from = normalizeTime(schedule?.timing?.from);
    const to = normalizeTime(schedule?.timing?.to);
    const days = schedule?.days || {};

    if (timezone !== GOVERNANCE.timezone) violations.push(`SCHEDULE_${index}_TIMEZONE_NOT_AMERICA_NEW_YORK`);
    if (from !== GOVERNANCE.from) violations.push(`SCHEDULE_${index}_START_NOT_08_00`);
    if (to !== GOVERNANCE.to) violations.push(`SCHEDULE_${index}_STOP_NOT_18_00`);

    for (const [day, expected] of Object.entries(GOVERNANCE.days)) {
      if (Boolean(days?.[day]) !== expected) violations.push(`SCHEDULE_${index}_DAY_${day}_MISMATCH`);
    }
  });

  return {
    compliant: violations.length === 0,
    timezone: GOVERNANCE.timezone,
    from: GOVERNANCE.from,
    to: GOVERNANCE.to,
    days: { ...GOVERNANCE.days },
    scheduleLayers: schedules.length,
    violations: [...new Set(violations)]
  };
}

function inspectSenderCapacity(campaign = {}, senderCount = 0) {
  const count = Number(senderCount || 0);
  const raw = campaign.daily_limit ?? campaign.dailyLimit ?? campaign.daily_max_leads ?? campaign.dailyMaxLeads;
  const dailyLimit = Number(raw || 0);
  const maximum = count > 0 ? count * GOVERNANCE.maxDailyPerInbox : 0;
  const violations = [];
  if (count <= 0) violations.push('NO_SENDERS_ASSIGNED');
  if (!(dailyLimit > 0)) violations.push('DAILY_LIMIT_ZERO_OR_UNSET');
  if (maximum > 0 && dailyLimit > maximum) violations.push('DAILY_LIMIT_EXCEEDS_25_PER_INBOX');
  return { compliant: violations.length === 0, senderCount: count, dailyLimit, maximumDailyLimit: maximum, violations };
}

module.exports = { GOVERNANCE, campaignSchedule, inspectCampaignSchedule, inspectSenderCapacity };
