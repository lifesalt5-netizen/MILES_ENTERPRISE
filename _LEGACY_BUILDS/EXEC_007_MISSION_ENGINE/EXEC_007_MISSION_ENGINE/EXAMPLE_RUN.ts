import { MissionAutomationEngine } from './MISSION_ENGINE';
import { BusinessGoal, CompanyStateSnapshot } from './MISSION_MODELS';

const state: CompanyStateSnapshot = {
  timestamp: new Date().toISOString(),
  revenueGoal: 10000,
  clientGoal: 5,
  callsGoal: 20,
  proposalsGoal: 5,
  providers: [
    { provider: 'filesystem', status: 'READY', capabilities: ['segment_inventory.select', 'campaign_payload.create', 'executive_report.generate', 'audit.verify_logs'], controlledWritesEnabled: true },
    { provider: 'instantly', status: 'READY_READ_ONLY', capabilities: ['provider.health_check', 'campaign.verify_read', 'campaign.monitor_replies'], controlledWritesEnabled: false },
    { provider: 'orion', status: 'READY_READ_ONLY', capabilities: ['orion.refresh_datasets', 'orion.run_intelligence_jobs', 'orion.verify_data'], controlledWritesEnabled: false },
    { provider: 'website', status: 'NOT_CONFIGURED', capabilities: [], controlledWritesEnabled: false }
  ],
  activeCampaigns: ['GSA 500k–3m', 'HubZone', 'Sam Low Sales']
};

const goals: BusinessGoal[] = [
  {
    goalId: 'GOAL_REVENUE_10000',
    name: 'Generate $10,000 Revenue Mission',
    category: 'REVENUE',
    objective: 'Create and manage the next revenue-producing outreach mission.',
    priority: 1,
    target: { revenue: 10000, segment: 'GSA 500k–3m', campaignName: 'GSA 500k–3m' },
    schedule: { mode: 'DAILY', enabled: true }
  },
  {
    goalId: 'GOAL_ORION_DAILY',
    name: 'Daily ORION Intelligence Refresh',
    category: 'ORION',
    objective: 'Refresh ORION intelligence and prepare executive reporting.',
    priority: 2,
    schedule: { mode: 'DAILY', enabled: true }
  }
];

async function main() {
  const engine = new MissionAutomationEngine();
  const missions = engine.createMissions(goals, state);
  console.log(JSON.stringify({ created: missions }, null, 2));
  const afterRun = await engine.runOnce();
  console.log(JSON.stringify({ afterRun }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
