import { BusinessGoal, CompanyStateSnapshot, Mission } from './MISSION_MODELS';
import { missionFromGoal } from './MISSION_TEMPLATES';

export class MissionPlanner {
  plan(goal: BusinessGoal, state: CompanyStateSnapshot): Mission {
    const mission = missionFromGoal(goal);

    const providerStatuses = new Map(state.providers.map(p => [p.provider, p]));
    for (const task of mission.tasks) {
      const provider = providerStatuses.get(task.provider);
      if (!provider && !['filesystem', 'provider_registry'].includes(task.provider)) {
        task.status = 'BLOCKED';
        task.governance = { allowed: false, approvalRequired: false, reason: `Provider ${task.provider} not configured.` };
      }
      if (provider?.status === 'READY_READ_ONLY' && String(task.capability).includes('create_or_update')) {
        task.status = 'BLOCKED';
        task.governance = { allowed: false, approvalRequired: false, reason: `${task.provider} is read-only. Controlled write remains disabled.` };
      }
      if (provider && !provider.capabilities.includes(task.capability) && !task.capability.includes('controlled')) {
        task.status = 'BLOCKED';
        task.governance = { allowed: false, approvalRequired: false, reason: `${task.provider} capability unavailable: ${task.capability}.` };
      }
    }

    if (mission.tasks.some(t => t.status === 'BLOCKED')) mission.status = 'BLOCKED';
    if (mission.tasks.some(t => t.status === 'ESCALATED')) mission.status = 'ESCALATED';
    return mission;
  }
}
