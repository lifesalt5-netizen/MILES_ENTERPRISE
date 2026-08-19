'use strict';

const path = require('path');

async function main() {
  const root = process.argv[2] || process.cwd();
  const dotenvPath = path.join(root, 'node_modules', 'dotenv');
  const dotenv = require(dotenvPath);
  dotenv.config({ path: path.join(root, '.env'), override: true, quiet: true });

  const Service = require(path.join(root, 'SERVICES', 'CalendlyRevenuePipelineService.js'));
  const service = new Service({ rootDir: root });
  const result = await service.runOnce();

  console.log('============================================================');
  console.log('MILES CALENDLY REVENUE PIPELINE SYNC - READ ONLY');
  console.log('============================================================');
  console.log(`status: ${result.status}`);
  console.log(`account: ${result.account || 'unknown'}`);
  console.log(`p2gc_events: ${result.metrics.p2gcEvents}`);
  console.log(`active_meetings: ${result.metrics.activeMeetings}`);
  console.log(`upcoming_meetings: ${result.metrics.upcomingMeetings}`);
  console.log(`past_active_meetings: ${result.metrics.pastActiveMeetings}`);
  console.log(`canceled_meetings: ${result.metrics.canceledMeetings}`);
  console.log('External writes performed: False');
  console.log('Output: DATA\\revenue_pipeline\\latest_calendly_meeting_pipeline.json');
}

main().catch(error => {
  console.error(`Calendly revenue pipeline sync failed: ${error.message}`);
  process.exit(1);
});
