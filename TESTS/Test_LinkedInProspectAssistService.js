'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const LinkedInProspectAssistService = require('../SERVICES/revenue/LinkedInProspectAssistService');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-linkedin-assist-'));
  fs.mkdirSync(path.join(root, 'DATA', 'CRM'), { recursive: true });
  fs.writeFileSync(path.join(root, 'DATA', 'CRM', 'canonical_crm.json'), JSON.stringify({ records: [
    { email: 'john@example.com', firstName: 'John', lastName: 'Smith', companyName: 'Example Co', title: 'VP Growth', stage: 'Contacted', linkedinProfileUrl: 'https://www.linkedin.com/in/john-smith-example' }
  ]}, null, 2));

  const instantlySource = {
    async listEmails() {
      return { items: [
        { to_address_email: 'john@example.com', timestamp_email: '2026-08-24T20:00:00Z', campaign_id: 'c1', custom_variables: { verified_condition: 'your GSA Schedule appears underutilized' } },
        { to_address_email: 'jane@acme.test', timestamp_email: '2026-08-24T19:00:00Z', campaign_id: 'c2', custom_variables: { first_name: 'Jane', last_name: 'Doe', company_name: 'Acme Systems' } }
      ], next_starting_after: null };
    }
  };

  const service = new LinkedInProspectAssistService({ rootDir: root, instantlySource });
  const result = await service.run();
  assert.equal(result.ok, true);
  assert.equal(result.prospectCount, 2);
  assert.equal(result.explicitLinkedInProfiles, 1);
  assert.equal(result.publicSearchRequired, 1);
  const john = result.prospects.find(x => x.email === 'john@example.com');
  const jane = result.prospects.find(x => x.email === 'jane@acme.test');
  assert.equal(john.recommendedAction, 'OPEN_PROFILE_AND_CONNECT_MANUALLY');
  assert.equal(jane.recommendedAction, 'PUBLIC_WEB_PROFILE_SEARCH');
  assert.equal(john.linkedinMutationAllowed, false);
  assert.equal(result.safety.linkedinScraping, false);
  assert.equal(result.safety.automatedConnectionRequests, false);
  assert.equal(result.safety.automatedDirectMessages, false);
  assert.ok(fs.existsSync(result.htmlFile));
  console.log('LINKEDIN_PROSPECT_ASSIST_TEST=GREEN');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
