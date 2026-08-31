'use strict';

require('dotenv').config();

const path = require('path');

process.env.MILES_ROOT = process.env.MILES_ROOT || __dirname;

// Apply durable government-data routing precedence before the unified
// gateway loads the command center. The override is idempotent and protects
// GSA/SAM/USAspending executive missions from incidental website/Instantly
// language during future planner updates.
require(path.join(
  __dirname,
  'SERVICES',
  'CommandIntentPlannerGovernmentDataOverride'
));

const gateway = require(path.join(
  __dirname,
  'SERVICES',
  'digital_coo',
  'UnifiedMilesGateway'
));

gateway.main();
