'use strict';

require('dotenv').config();

const path = require('path');

process.env.MILES_ROOT = process.env.MILES_ROOT || __dirname;

const gateway = require(path.join(
  __dirname,
  'SERVICES',
  'digital_coo',
  'UnifiedMilesGateway'
));

gateway.main();
