'use strict';

const path = require('path');
const { readCsv } = require('./csv_utils');

const DEFAULT_APPROVAL_REQUIRED = new Set([
  'send_client_email', 'send_campaign', 'start_campaign', 'publish_website_change',
  'delete_data', 'change_pricing', 'spend_money', 'grant_access', 'sign_agreement',
  'create_paid_account', 'change_dns_record'
]);

const DEFAULT_AUTO_APPROVED = new Set([
  'health_check', 'inventory_sync', 'dashboard_refresh', 'report_generate',
  'segment_count', 'domain_capacity_check', 'campaign_inventory_sync', 'task_queue_normalize',
  'repository_audit', 'status_update', 'recommendation_generate'
]);

function normalize(s) { return (s || '').toString().trim().toLowerCase().replace(/\s+/g, '_'); }

function loadAuthorityRules(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'governance', 'MILES_AUTHORITY_MATRIX.csv'),
    path.join(repoRoot, 'CONFIG', 'MILES_AUTHORITY_MATRIX.csv')
  ];
  const rules = [];
  for (const file of candidates) {
    for (const row of readCsv(file)) {
      const action = normalize(row.Action || row.action || row.Capability || row.capability || row.Task || row.task);
      const decision = normalize(row.Decision || row.decision || row.Authority || row.authority || row.Approval || row.approval || row.RequiresApproval);
      if (action) rules.push({ action, decision, source: file });
    }
  }
  return rules;
}

function evaluateAuthority(repoRoot, actionType, riskLevel) {
  const action = normalize(actionType);
  const risk = normalize(riskLevel || 'low');
  const rules = loadAuthorityRules(repoRoot);
  const exact = rules.find(r => r.action === action);
  if (exact) {
    if (/ceo|approve|required|manual|immediate|kevin/.test(exact.decision)) return { allowed: false, requiresApproval: true, reason: `Authority matrix requires approval for ${action}` };
    if (/auto|miles|allowed|execute/.test(exact.decision)) return { allowed: true, requiresApproval: false, reason: `Authority matrix allows ${action}` };
  }
  if (DEFAULT_APPROVAL_REQUIRED.has(action) || risk === 'high') return { allowed: false, requiresApproval: true, reason: `Protected action or high risk: ${action}` };
  if (DEFAULT_AUTO_APPROVED.has(action) && risk !== 'high') return { allowed: true, requiresApproval: false, reason: `Default safe automation: ${action}` };
  if (risk === 'medium') return { allowed: false, requiresApproval: true, reason: `Medium-risk unregistered action requires CEO approval: ${action}` };
  return { allowed: true, requiresApproval: false, reason: `Low-risk operational action: ${action}` };
}

module.exports = { evaluateAuthority, loadAuthorityRules };
