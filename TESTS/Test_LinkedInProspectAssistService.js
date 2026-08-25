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
        { to_address_email: 'john@example.com', timestamp_email: '2026-08-24T20:00:00Z', campaign_id: 'c1' },
        { to_address_email: 'jane@acme.test', timestamp_email: '2026-08-24T19:00:00Z', campaign_id: 'c2' },
        { to_address_email: 'mystery@gmail.com', timestamp_email: '2026-08-24T18:00:00Z', campaign_id: 'c3' }
      ], next_starting_after: null };
    },
    async listLeads(filters) {
      if (filters.campaign === 'c2') {
        return { items: [
          { email: 'jane@acme.test', first_name: 'Jane', last_name: 'Doe', company_name: 'Acme Systems', job_title: 'President', custom_variables: { verified_condition: 'a federal revenue gap' } }
        ], next_starting_after: null };
      }
      if (filters.campaign === 'c3') {
        return { items: [{ email: 'mystery@gmail.com' }], next_starting_after: null };
      }
      return { items: [], next_starting_after: null };
    }
  };

  const service = new LinkedInProspectAssistService({ rootDir: root, instantlySource });
  const result = await service.run();
  assert.equal(result.ok, true);
  assert.equal(result.prospectCount, 3);
  assert.equal(result.explicitLinkedInProfiles, 1);
  assert.equal(result.publicSearchRequired, 1);
  assert.equal(result.insufficientIdentity, 1);
  assert.equal(result.instantlyLeadMatched, 2);

  const john = result.prospects.find(x => x.email === 'john@example.com');
  const jane = result.prospects.find(x => x.email === 'jane@acme.test');
  const mystery = result.prospects.find(x => x.email === 'mystery@gmail.com');

  assert.equal(john.recommendedAction, 'OPEN_PROFILE_AND_CONNECT_MANUALLY');
  assert.equal(jane.recommendedAction, 'PUBLIC_WEB_PROFILE_SEARCH');
  assert.equal(jane.firstName, 'Jane');
  assert.equal(jane.companyName, 'Acme Systems');
  assert.ok(jane.profileSearchQuery.includes('Jane Doe'));
  assert.ok(jane.profileSearchQuery.includes('Acme Systems'));
  assert.equal(mystery.identityStatus, 'INSUFFICIENT_IDENTITY');
  assert.equal(mystery.profileSearchUrl, '');
  assert.equal(mystery.recommendedAction, 'IDENTITY_ENRICHMENT_REQUIRED');
  assert.equal(john.linkedinMutationAllowed, false);
  assert.equal(result.safety.linkedinScraping, false);
  assert.equal(result.safety.automatedConnectionRequests, false);
  assert.equal(result.safety.automatedDirectMessages, false);
  assert.equal(result.safety.consumerDomainOnlySearchSuppressedWithoutIdentity, true);
  assert.ok(fs.existsSync(result.htmlFile));
  console.log('LINKEDIN_PROSPECT_ASSIST_TEST=GREEN');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
