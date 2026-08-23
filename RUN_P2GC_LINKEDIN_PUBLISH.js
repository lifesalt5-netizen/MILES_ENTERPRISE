'use strict';

require('dotenv').config();
const P2GCLinkedInPublishingService = require('./SERVICES/revenue/P2GCLinkedInPublishingService');

async function main() {
  const publish = String(process.env.P2GC_LINKEDIN_PUBLISH || '').trim().toLowerCase() === 'true';
  const contentId = String(process.env.P2GC_LINKEDIN_CONTENT_ID || '').trim();
  const service = new P2GCLinkedInPublishingService();
  const result = await service.run({ publish, contentId });
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
