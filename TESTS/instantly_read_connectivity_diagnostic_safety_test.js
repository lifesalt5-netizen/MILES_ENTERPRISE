'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'SCRIPTS', 'DIAGNOSE_INSTANTLY_READ_CONNECTIVITY.js'), 'utf8');

assert(/getConfiguration/i.test(script), 'Diagnostic must inspect configuration metadata');
assert(/healthCheck/i.test(script), 'Diagnostic must run Instantly health check');
assert(/listCampaigns/i.test(script), 'Diagnostic must test campaign reads');
assert(/listAccounts/i.test(script), 'Diagnostic must test account reads');
assert(/listLeads/i.test(script), 'Diagnostic must test lead reads');
assert(/listEmails/i.test(script), 'Diagnostic must test email reads');
assert(/No API key value was printed/i.test(script), 'Diagnostic must explicitly avoid printing the key');
assert(!/(createCampaign|updateCampaign|pauseCampaign|activateCampaign|deleteCampaign|createLead|uploadLeads)/.test(script), 'Diagnostic must not invoke Instantly mutations');
assert(!/INSTANTLY_API_KEY\s*[:=].*process\.env\.INSTANTLY_API_KEY/i.test(script), 'Diagnostic must not print the API key value');

console.log('PASS instantly_read_connectivity_diagnostic_safety_test');
