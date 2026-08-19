'use strict';

const path = require('path');

const root = path.resolve(process.argv[2] || process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = root;
const dotenv = require(path.join(root, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true });

const connector = require(path.join(root, 'CONNECTORS', 'INSTANTLY', 'connector.js'));

function sanitizeError(error) {
  if (!error) return null;
  return {
    message: String(error.message || error.error || error),
    statusCode: Number(error.statusCode || error.httpStatus || 0) || null,
    code: error.code || null
  };
}

async function safeCall(label, fn) {
  try {
    const value = await fn();
    return { label, ok: value?.ok !== false, value };
  } catch (error) {
    return { label, ok: false, error: sanitizeError(error) };
  }
}

(async () => {
  const config = await safeCall('configuration', () => connector.execute({ action: 'getConfiguration', payload: {} }, { audit: true, readOnly: true }));
  const health = await safeCall('health', () => connector.healthCheck());
  const campaigns = await safeCall('campaigns', () => connector.execute({ action: 'listCampaigns', payload: { limit: 1 } }, { audit: true, readOnly: true }));
  const accounts = await safeCall('accounts', () => connector.execute({ action: 'listAccounts', payload: { limit: 1 } }, { audit: true, readOnly: true }));
  const leads = await safeCall('leads', () => connector.execute({ action: 'listLeads', payload: { limit: 1 } }, { audit: true, readOnly: true }));
  const emails = await safeCall('emails', () => connector.execute({ action: 'listEmails', payload: { limit: 1 } }, { audit: true, readOnly: true }));

  const cfg = config.value?.configuration || {};
  console.log('============================================================');
  console.log('MILES INSTANTLY READ CONNECTIVITY DIAGNOSTIC');
  console.log('============================================================');
  console.log(`apiKeyConfigured: ${Boolean(cfg.apiKeyConfigured)}`);
  console.log(`baseUrl: ${cfg.baseUrl || '(not reported)'}`);
  console.log(`dryRun: ${cfg.dryRun !== undefined ? cfg.dryRun : '(not reported)'}`);
  console.log(`mutationsAllowed: ${cfg.mutationsAllowed !== undefined ? cfg.mutationsAllowed : '(not reported)'}`);

  for (const row of [health, campaigns, accounts, leads, emails]) {
    let statusCode = null;
    let errorText = '';
    if (row.error) {
      statusCode = row.error.statusCode;
      errorText = row.error.message;
    } else if (row.value?.ok === false) {
      statusCode = row.value.statusCode || row.value.httpStatus || null;
      errorText = row.value.error || row.value.message || '';
    }
    console.log(`${row.label}: ok=${Boolean(row.ok)} statusCode=${statusCode ?? 'none'} error=${errorText || 'none'}`);
  }

  console.log('External writes performed: False');
  console.log('No API key value was printed.');

  const allReadOk = [health, campaigns, accounts, leads, emails].every(row => row.ok);
  process.exitCode = allReadOk ? 0 : 2;
})().catch(error => {
  console.error(`DIAGNOSTIC_FATAL: ${error.message}`);
  process.exitCode = 1;
});
