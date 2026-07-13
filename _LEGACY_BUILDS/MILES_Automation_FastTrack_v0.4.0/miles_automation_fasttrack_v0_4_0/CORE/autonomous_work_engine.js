'use strict';

const fs = require('fs');
const path = require('path');
const { readCsv, writeCsv, appendCsv, countRows, ensureDir } = require('./csv_utils');
const { evaluateAuthority } = require('./authority_gate');

const LOG_HEADERS = ['timestamp','task_id','capability_id','action_type','status','message','details'];
const APPROVAL_HEADERS = ['timestamp','task_id','capability_id','action_type','risk_level','reason','requested_action','status'];

function now() { return new Date().toISOString(); }
function p(root, ...parts) { return path.join(root, ...parts); }
function exists(filePath) { return fs.existsSync(filePath); }

function pickFirstExisting(root, candidates) {
  for (const c of candidates) {
    const f = p(root, ...c.split('/'));
    if (exists(f)) return f;
  }
  return p(root, ...candidates[0].split('/'));
}

class MilesAutonomousWorkEngine {
  constructor(repoRoot) {
    this.repoRoot = repoRoot || process.cwd();
    this.capabilityRegistry = p(this.repoRoot, 'CONFIG', 'MILES_CAPABILITY_REGISTRY.csv');
    this.executionLog = p(this.repoRoot, 'logs', 'miles_automation_execution_log.csv');
    this.approvalQueue = p(this.repoRoot, 'tasks', 'approval_queue.csv');
    this.reportsDir = p(this.repoRoot, 'reports');
    this.statusDir = p(this.repoRoot, 'status');
  }

  log(row) {
    appendCsv(this.executionLog, Object.assign({ timestamp: now() }, row), LOG_HEADERS);
  }

  requireApproval(task, decision) {
    appendCsv(this.approvalQueue, {
      timestamp: now(),
      task_id: task.task_id || `TASK-${Date.now()}`,
      capability_id: task.CapabilityID || task.capability_id || '',
      action_type: task.ActionType || task.action_type || '',
      risk_level: task.RiskLevel || task.risk_level || '',
      reason: decision.reason,
      requested_action: task.CapabilityName || task.capability_name || task.Request || '',
      status: 'PENDING_CEO_APPROVAL'
    }, APPROVAL_HEADERS);
  }

  loadCapabilities() {
    return readCsv(this.capabilityRegistry);
  }

  runCapability(cap) {
    const action = cap.ActionType || cap.action_type;
    const decision = evaluateAuthority(this.repoRoot, action, cap.RiskLevel || cap.risk_level);
    const taskId = `${cap.CapabilityID || 'CAP'}-${Date.now()}`;
    if (decision.requiresApproval) {
      this.requireApproval(Object.assign({}, cap, { task_id: taskId }), decision);
      this.log({ task_id: taskId, capability_id: cap.CapabilityID, action_type: action, status: 'QUEUED_APPROVAL', message: decision.reason, details: cap.CapabilityName });
      return { status: 'QUEUED_APPROVAL', capability: cap.CapabilityName };
    }

    try {
      let result;
      switch (cap.CapabilityID) {
        case 'CAP-001': result = this.refreshDashboard(); break;
        case 'CAP-002': result = this.syncCampaignInventory(); break;
        case 'CAP-003': result = this.checkDomainCapacity(); break;
        case 'CAP-004': result = this.refreshSegmentCounts(); break;
        case 'CAP-005': result = this.generateDailyBrief(); break;
        case 'CAP-007': result = this.repositoryDuplicateAudit(); break;
        case 'CAP-008': result = this.instantlyHealthSnapshot(); break;
        case 'CAP-009': result = this.websiteQueueReview(); break;
        default: result = { message: 'Capability registered but no local executor bound yet.' };
      }
      this.log({ task_id: taskId, capability_id: cap.CapabilityID, action_type: action, status: 'COMPLETED', message: cap.CapabilityName, details: JSON.stringify(result) });
      return { status: 'COMPLETED', capability: cap.CapabilityName, result };
    } catch (err) {
      this.log({ task_id: taskId, capability_id: cap.CapabilityID, action_type: action, status: 'FAILED', message: err.message, details: err.stack || '' });
      return { status: 'FAILED', capability: cap.CapabilityName, error: err.message };
    }
  }

  syncCampaignInventory() {
    const campaignFile = pickFirstExisting(this.repoRoot, ['outbound/campaign_inventory.csv','masters/CAMPAIGN_MASTER.csv','MILES_DASHBOARD.csv']);
    const campaigns = readCsv(campaignFile);
    const statusCounts = {};
    for (const c of campaigns) {
      const status = (c.status || c.Status || c.campaign_status || c.CampaignStatus || 'UNKNOWN').toString().trim() || 'UNKNOWN';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    const rows = Object.keys(statusCounts).map(k => ({ status: k, count: statusCounts[k], source_file: campaignFile, updated_at: now() }));
    writeCsv(p(this.repoRoot, 'reports', 'campaign_inventory_status.csv'), rows, ['status','count','source_file','updated_at']);
    return { campaigns: campaigns.length, statusCounts };
  }

  checkDomainCapacity() {
    const domainFile = pickFirstExisting(this.repoRoot, ['masters/DOMAIN_MASTER.csv','outbound/outbound_accounts.csv']);
    const rows = readCsv(domainFile);
    const report = rows.map(r => ({
      domain: r.domain || r.Domain || r.sending_domain || r.SendingDomain || r.email_domain || '',
      inbox: r.email || r.Email || r.inbox || r.Inbox || '',
      daily_limit: r.daily_limit || r.DailyLimit || r.limit || r.Limit || '',
      status: r.status || r.Status || 'UNKNOWN',
      recommendation: 'monitor'
    }));
    writeCsv(p(this.repoRoot, 'reports', 'domain_capacity_report.csv'), report, ['domain','inbox','daily_limit','status','recommendation']);
    return { rows: report.length };
  }

  refreshSegmentCounts() {
    const segmentFile = pickFirstExisting(this.repoRoot, ['masters/SEGMENT_INVENTORY.csv','inventory/segment_inventory_master.csv','inventory/segment_counts.csv']);
    const segments = readCsv(segmentFile);
    const emailReady = segments.filter(s => /yes|y|true|ready|1/i.test(s.Email_Ready || s.email_ready || s.Ready || '')).length;
    const report = [{ source_file: segmentFile, segment_rows: segments.length, email_ready_rows: emailReady, updated_at: now() }];
    writeCsv(p(this.repoRoot, 'reports', 'segment_status_report.csv'), report, ['source_file','segment_rows','email_ready_rows','updated_at']);
    return report[0];
  }

  refreshDashboard() {
    const rows = [
      { metric: 'segments', value: countRows(p(this.repoRoot, 'masters', 'SEGMENT_INVENTORY.csv')) || countRows(p(this.repoRoot, 'inventory', 'segment_inventory_master.csv')), updated_at: now() },
      { metric: 'campaigns', value: countRows(p(this.repoRoot, 'outbound', 'campaign_inventory.csv')) || countRows(p(this.repoRoot, 'masters', 'CAMPAIGN_MASTER.csv')), updated_at: now() },
      { metric: 'domains', value: countRows(p(this.repoRoot, 'masters', 'DOMAIN_MASTER.csv')) || countRows(p(this.repoRoot, 'outbound', 'outbound_accounts.csv')), updated_at: now() },
      { metric: 'approval_queue', value: countRows(this.approvalQueue), updated_at: now() }
    ];
    writeCsv(p(this.repoRoot, 'MILES_DASHBOARD.csv'), rows, ['metric','value','updated_at']);
    return { metrics: rows.length };
  }

  instantlyHealthSnapshot() {
    const campaignStatus = readCsv(p(this.repoRoot, 'reports', 'campaign_inventory_status.csv'));
    const accounts = readCsv(p(this.repoRoot, 'outbound', 'outbound_accounts.csv'));
    const rows = [{ updated_at: now(), campaign_status_rows: campaignStatus.length, outbound_accounts: accounts.length, status: 'SNAPSHOT_ONLY', note: 'No external write performed.' }];
    writeCsv(p(this.repoRoot, 'reports', 'instantly_health_snapshot.csv'), rows, ['updated_at','campaign_status_rows','outbound_accounts','status','note']);
    return rows[0];
  }

  websiteQueueReview() {
    const queue = readCsv(p(this.repoRoot, 'WEBSITE_OPS', 'WEBSITE_CHANGE_QUEUE.csv'));
    const approval = readCsv(p(this.repoRoot, 'WEBSITE_OPS', 'WEBSITE_APPROVAL_QUEUE.csv'));
    const rows = [{ updated_at: now(), queued_changes: queue.length, pending_approvals: approval.length, status: approval.length > 0 ? 'CEO_APPROVAL_PENDING' : 'OK' }];
    writeCsv(p(this.repoRoot, 'reports', 'website_ops_status.csv'), rows, ['updated_at','queued_changes','pending_approvals','status']);
    return rows[0];
  }

  repositoryDuplicateAudit() {
    const treeFile = p(this.repoRoot, 'repository_tree.txt');
    const raw = exists(treeFile) ? fs.readFileSync(treeFile, 'utf16le') : '';
    const flags = [
      ['MILES_OS_v1', /\\MILES_OS_v1/i.test(raw)],
      ['miles_core_framework_dropin', /\\miles_core_framework_dropin/i.test(raw)],
      ['miles_instantly_connector', /\\miles_instantly_connector/i.test(raw)],
      ['MILES_Platform_v0.3.0_Local_Operator', /\\MILES_Platform_v0\.3\.0_Local_Operator/i.test(raw)],
      ['root_node_modules', /\\node_modules/i.test(raw)]
    ];
    const rows = flags.map(([item, present]) => ({ item, present: present ? 'YES' : 'NO', recommendation: present ? 'treat_as_legacy_or_dependency; do_not_delete_until backed up and compared' : 'none', updated_at: now() }));
    writeCsv(p(this.repoRoot, 'reports', 'repository_consolidation_report.csv'), rows, ['item','present','recommendation','updated_at']);
    return { flags: rows.filter(r => r.present === 'YES').length };
  }

  generateDailyBrief() {
    this.syncCampaignInventory();
    this.checkDomainCapacity();
    this.refreshSegmentCounts();
    this.websiteQueueReview();
    this.instantlyHealthSnapshot();
    this.refreshDashboard();
    const lines = [
      '# MILES Daily Executive Brief',
      '',
      `Generated: ${now()}`,
      '',
      '## Automation Status',
      '- Safe operational automations executed.',
      '- Protected actions remain gated through CEO approval queue.',
      '',
      '## Reports Updated',
      '- reports/campaign_inventory_status.csv',
      '- reports/domain_capacity_report.csv',
      '- reports/segment_status_report.csv',
      '- reports/website_ops_status.csv',
      '- reports/instantly_health_snapshot.csv',
      '',
      '## CEO Attention',
      `- Approval queue rows: ${countRows(this.approvalQueue)}`,
      ''
    ];
    ensureDir(p(this.repoRoot, 'status', 'daily_status.md'));
    fs.writeFileSync(p(this.repoRoot, 'status', 'daily_status.md'), lines.join('\n'), 'utf8');
    return { dailyStatus: p(this.repoRoot, 'status', 'daily_status.md') };
  }

  runAll() {
    ensureDir(this.executionLog);
    ensureDir(this.approvalQueue);
    const caps = this.loadCapabilities();
    const results = caps.map(c => this.runCapability(c));
    writeCsv(p(this.repoRoot, 'reports', 'miles_automation_run_summary.csv'), results.map(r => ({ timestamp: now(), status: r.status, capability: r.capability, detail: r.error || JSON.stringify(r.result || {}) })), ['timestamp','status','capability','detail']);
    return results;
  }
}

if (require.main === module) {
  const repoRoot = process.argv[2] || process.cwd();
  const engine = new MilesAutonomousWorkEngine(repoRoot);
  const results = engine.runAll();
  console.log('MILES AUTOMATION FASTTRACK COMPLETE');
  for (const r of results) console.log(`${r.status}: ${r.capability}`);
}

module.exports = { MilesAutonomousWorkEngine };
