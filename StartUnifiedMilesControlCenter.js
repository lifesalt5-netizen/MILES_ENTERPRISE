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

// Preserve connector semantic truth before the gateway loads execution
// ownership. A governed BLOCKED, IN_PROGRESS, QUEUED, RUNNING, or
// AWAITING_APPROVAL result must never be collapsed into FAILED/COMPLETED.
require(path.join(
  __dirname,
  'SERVICES',
  'ExecutionStatusSemanticsOverride'
));

const gateway = require(path.join(
  __dirname,
  'SERVICES',
  'digital_coo',
  'UnifiedMilesGateway'
));

gateway.main();
