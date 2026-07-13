import { BusinessGoal, Mission, MissionCategory, MissionTask } from './MISSION_MODELS';
import { evaluateGovernance } from './MISSION_GOVERNANCE';
import { id, nowIso } from './MISSION_UTILS';

function task(missionId: string, name: string, provider: string, capability: string, parameters: Record<string, unknown>, dependencies: string[] = [], priority = 5): MissionTask {
  const governance = evaluateGovernance(name, capability, parameters);
  const ts = nowIso();
  return {
    taskId: id('TASK'),
    missionId,
    name,
    provider,
    capability,
    parameters,
    dependencies,
    priority,
    status: governance.approvalRequired ? 'ESCALATED' : 'PENDING',
    attemptCount: 0,
    maxAttempts: 3,
    verification: { required: true, method: 'CHECK_STATE' },
    governance,
    createdAt: ts,
    updatedAt: ts
  };
}

function baseMission(goal: BusinessGoal, category: MissionCategory): Mission {
  const ts = nowIso();
  const missionId = id('MISSION');
  return {
    missionId,
    name: goal.name,
    category,
    priority: goal.priority,
    status: 'PENDING',
    objective: goal.objective,
    owner: 'MILES',
    createdAt: ts,
    updatedAt: ts,
    schedule: goal.schedule ?? { mode: 'DAILY', enabled: true },
    successCriteria: goal.target ?? {},
    governanceRequired: false,
    retryPolicy: { strategy: 'LINEAR', maxAttempts: 3, baseDelaySeconds: 60 },
    verificationPolicy: { required: true, method: 'CHECK_STATE' },
    tasks: [],
    sourceGoalId: goal.goalId
  };
}

export function revenueMission(goal: BusinessGoal): Mission {
  const mission = baseMission(goal, 'REVENUE');
  const segment = goal.target?.segment ?? 'best_available_revenue_segment';
  const campaignName = goal.target?.campaignName ?? 'Miles Revenue Campaign';
  const t1 = task(mission.missionId, 'Select outreach segment', 'filesystem', 'segment_inventory.select', { segment, requireVerifiedEmail: true }, [], 1);
  const t2 = task(mission.missionId, 'Verify provider readiness', 'instantly', 'provider.health_check', { provider: 'instantly', writeMode: 'controlled' }, [t1.taskId], 1);
  const t3 = task(mission.missionId, 'Prepare campaign payload', 'filesystem', 'campaign_payload.create', { campaignName, segment }, [t1.taskId, t2.taskId], 2);
  const t4 = task(mission.missionId, 'Submit campaign to business execution engine', 'instantly', 'campaign.create_or_update_controlled', { campaignName, segment, requiresControlledWrite: true }, [t3.taskId], 3);
  const t5 = task(mission.missionId, 'Verify campaign exists', 'instantly', 'campaign.verify_read', { campaignName }, [t4.taskId], 4);
  const t6 = task(mission.missionId, 'Start reply monitoring mission', 'instantly', 'campaign.monitor_replies', { campaignName }, [t5.taskId], 5);
  mission.tasks = [t1, t2, t3, t4, t5, t6];
  mission.governanceRequired = mission.tasks.some(t => t.governance.approvalRequired);
  return mission;
}

export function websiteMission(goal: BusinessGoal): Mission {
  const mission = baseMission(goal, 'WEBSITE');
  const page = goal.target?.page ?? 'Home';
  const t1 = task(mission.missionId, 'Backup website', 'website', 'website.backup', { scope: 'full' }, [], 1);
  const t2 = task(mission.missionId, 'Apply approved page change', 'website', 'website.edit_page_controlled', { page, changeId: goal.target?.changeId ?? 'WEBSITE_CHANGE_QUEUE_NEXT' }, [t1.taskId], 2);
  const t3 = task(mission.missionId, 'Publish website', 'website', 'website.publish_controlled', { page }, [t2.taskId], 3);
  const t4 = task(mission.missionId, 'Verify website page', 'website', 'website.verify_page', { page }, [t3.taskId], 4);
  mission.tasks = [t1, t2, t3, t4];
  mission.governanceRequired = mission.tasks.some(t => t.governance.approvalRequired);
  return mission;
}

export function orionMission(goal: BusinessGoal): Mission {
  const mission = baseMission(goal, 'ORION');
  const t1 = task(mission.missionId, 'Refresh ORION datasets', 'orion', 'orion.refresh_datasets', { mode: 'read_safe' }, [], 1);
  const t2 = task(mission.missionId, 'Run intelligence jobs', 'orion', 'orion.run_intelligence_jobs', { jobs: goal.target?.jobs ?? ['contractor_profile', 'persona_scores', 'recommendations'] }, [t1.taskId], 2);
  const t3 = task(mission.missionId, 'Verify ORION data quality', 'orion', 'orion.verify_data', { checks: ['row_counts', 'schema', 'freshness'] }, [t2.taskId], 3);
  const t4 = task(mission.missionId, 'Generate executive report', 'filesystem', 'executive_report.generate', { source: 'orion' }, [t3.taskId], 4);
  mission.tasks = [t1, t2, t3, t4];
  mission.governanceRequired = mission.tasks.some(t => t.governance.approvalRequired);
  return mission;
}

export function administrationMission(goal: BusinessGoal): Mission {
  const mission = baseMission(goal, 'ADMINISTRATION');
  const t1 = task(mission.missionId, 'Provider synchronization', 'provider_registry', 'providers.sync', {}, [], 1);
  const t2 = task(mission.missionId, 'Health checks', 'provider_registry', 'providers.health_check_all', {}, [t1.taskId], 2);
  const t3 = task(mission.missionId, 'Audit log verification', 'filesystem', 'audit.verify_logs', {}, [t2.taskId], 3);
  mission.tasks = [t1, t2, t3];
  return mission;
}

export function missionFromGoal(goal: BusinessGoal): Mission {
  if (goal.category === 'REVENUE' || goal.category === 'SALES') return revenueMission(goal);
  if (goal.category === 'WEBSITE' || goal.category === 'MARKETING') return websiteMission(goal);
  if (goal.category === 'ORION') return orionMission(goal);
  return administrationMission(goal);
}
