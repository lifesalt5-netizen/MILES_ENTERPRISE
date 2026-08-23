'use strict';

const repair = require('../SCRIPTS/RepairInstantlyWeekdaySchedules');
const governance = require('../SCRIPTS/AuditInstantlyCampaignScheduleGovernance');

const { REQUIRED_DAYS, daysMatch, repairedSchedule } = repair;

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(`[FAIL] ${label}`);
  passed += 1;
  console.log(`[PASS] ${label}`);
}

check(REQUIRED_DAYS['0'] === false, 'Sunday index 0 is disabled');
check(REQUIRED_DAYS['1'] === true, 'Monday index 1 is enabled');
check(REQUIRED_DAYS['5'] === true, 'Friday index 5 is enabled');
check(REQUIRED_DAYS['6'] === false, 'Saturday index 6 is disabled');
check(JSON.stringify(governance.REQUIRED_DAYS) === JSON.stringify(REQUIRED_DAYS), 'governance and repair use the same weekday map');
check(daysMatch({ '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false }) === true, 'Mon-Fri map passes');
check(daysMatch({ '0': true, '1': true, '2': true, '3': true, '4': true, '5': false, '6': false }) === false, 'legacy Sun-Thu map fails');

const repaired = repairedSchedule({
  start_date: '2026-08-08',
  schedules: [{
    name: 'Weekdays',
    timing: { from: '08:00', to: '18:00' },
    timezone: 'America/Detroit',
    days: { '0': true, '1': true, '2': true, '3': true, '4': true, '5': false, '6': false }
  }]
});
check(repaired.start_date === '2026-08-08', 'repair preserves campaign schedule metadata');
check(repaired.schedules[0].timing.from === '08:00' && repaired.schedules[0].timing.to === '18:00', 'repair preserves timing');
check(repaired.schedules[0].timezone === 'America/Detroit', 'repair preserves timezone');
check(repaired.schedules[0].days['0'] === false && repaired.schedules[0].days['5'] === true, 'repair flips Sunday off and Friday on');

console.log(`INSTANTLY_CAMPAIGN_SCHEDULE_GOVERNANCE_TEST_PASS ${passed}/${passed}`);
