'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const P2GCAcquisitionV2CampaignService = require('./SERVICES/revenue/P2GCAcquisitionV2CampaignService');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

async function main() {
  const offerId = String(process.env.P2GC_ACQ_V2_OFFER || process.argv[2] || '').trim().toUpperCase();
  const leadFile = String(process.env.P2GC_ACQ_V2_LEADS_FILE || process.argv[3] || '').trim();
  if (!offerId || !leadFile) {
    console.error('Usage: node RUN_P2GC_ACQUISITION_V2_DEPLOYMENT.js <OFFER_ID> <leads.json>');
    process.exit(2);
  }

  const fullLeadFile = path.resolve(leadFile);
  const payload = readJson(fullLeadFile);
  const leads = Array.isArray(payload) ? payload : Array.isArray(payload.leads) ? payload.leads : [];
  const execute = String(process.env.P2GC_ACQ_V2_EXECUTE || '').trim().toLowerCase() === 'true';
  const activate = String(process.env.P2GC_ACQ_V2_ACTIVATE || '').trim().toLowerCase() === 'true';

  const service = new P2GCAcquisitionV2CampaignService();
  const result = await service.deploy({ offerId, leads, execute, activate });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
