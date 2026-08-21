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

function minutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function inspectCampaignSchedule(campaign = {}) {
  const envelope = campaign.campaign_schedule || campaign.campaignSchedule || {};
  const schedules = Array.isArray(envelope.schedules) ? envelope.schedules : [];
  const violations = [];
  const allowedFrom = minutes(GOVERNANCE.from);
  const allowedTo = minutes(GOVERNANCE.to);

  if (!schedules.length) violations.push('SCHEDULE_NOT_PRESENT');

  schedules.forEach((schedule, index) => {
    const timezone = String(schedule?.timezone || '').trim();
    const from = normalizeTime(schedule?.timing?.from);
    const to = normalizeTime(schedule?.timing?.to);
    const fromMinutes = minutes(from);
    const toMinutes = minutes(to);
    const days = schedule?.days || {};

    if (timezone !== GOVERNANCE.timezone) violations.push(`SCHEDULE_${index}_TIMEZONE_NOT_AMERICA_NEW_YORK`);
    if (fromMinutes === null) violations.push(`SCHEDULE_${index}_START_INVALID`);
    else if (fromMinutes < allowedFrom) violations.push(`SCHEDULE_${index}_START_BEFORE_08_00`);
    if (toMinutes === null) violations.push(`SCHEDULE_${index}_STOP_INVALID`);
    else if (toMinutes > allowedTo) violations.push(`SCHEDULE_${index}_STOP_AFTER_18_00`);
    if (fromMinutes !== null && toMinutes !== null && fromMinutes >= toMinutes) violations.push(`SCHEDULE_${index}_INVALID_TIME_RANGE`);

    if (Boolean(days?.['5'])) violations.push(`SCHEDULE_${index}_SATURDAY_ENABLED`);
    if (Boolean(days?.['6'])) violations.push(`SCHEDULE_${index}_SUNDAY_ENABLED`);
    if (!['0','1','2','3','4'].some(day => Boolean(days?.[day]))) violations.push(`SCHEDULE_${index}_NO_WEEKDAY_ENABLED`);
  });

  return {
    compliant: violations.length === 0,
    timezone: GOVERNANCE.timezone,
    allowedFrom: GOVERNANCE.from,
    allowedTo: GOVERNANCE.to,
    allowedDays: { ...GOVERNANCE.days },
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
