import { BusinessGoal, CompanyStateSnapshot, Mission } from './MISSION_MODELS';
import { MissionGenerator } from './MISSION_GENERATOR';
import { MissionQueue } from './MISSION_QUEUE';
import { MissionVerifier } from './MISSION_VERIFIER';
import { MissionRetry } from './MISSION_RETRY';
import { MissionKpi } from './MISSION_KPI';
import { MissionAudit } from './MISSION_AUDIT';
import { MissionStateStore } from './MISSION_STATE';
import { BusinessExecutionEngineAdapter, DryRunExecutionAdapter } from './EXECUTION_ADAPTER';
import { nowIso } from './MISSION_UTILS';

export class MissionAutomationEngine {
  private generator = new MissionGenerator();
  private queue = new MissionQueue();
  private verifier = new MissionVerifier();
  private retry = new MissionRetry();
  private kpi = new MissionKpi();

  constructor(
    private executor: BusinessExecutionEngineAdapter = new DryRunExecutionAdapter(),
    private stateStore: MissionStateStore = new MissionStateStore(),
    private audit: MissionAudit = new MissionAudit()
  ) {
    for (const mission of this.stateStore.load()) this.queue.enqueue(mission);
  }

  createMissions(goals: BusinessGoal[], state: CompanyStateSnapshot): Mission[] {
    const missions = this.generator.generate(goals, state);
    for (const mission of missions) {
      this.queue.enqueue(mission);
      this.audit.write({ type: 'MISSION_CREATED', missionId: mission.missionId, name: mission.name, status: mission.status });
    }
    this.persist();
    return missions;
  }

  async runOnce(): Promise<Mission[]> {
    const missions = this.queue.list().filter(m => ['PENDING', 'RUNNING', 'RETRY'].includes(m.status));
    for (const mission of missions) {
      mission.status = 'RUNNING';
      const runnable = this.queue.nextRunnableTasks(mission.missionId);
      for (const task of runnable) {
        task.status = 'RUNNING';
        task.attemptCount += 1;
        task.updatedAt = nowIso();
        this.audit.write({ type: 'TASK_SUBMITTED', missionId: mission.missionId, taskId: task.taskId, capability: task.capability, attempt: task.attemptCount });

        const result = await this.executor.submitTask(task);
        task.auditId = result.auditId;
        const ok = this.verifier.verify(task, result);
        task.status = ok ? 'COMPLETED' : 'FAILED';
        task.updatedAt = nowIso();
        this.audit.write({ type: 'TASK_RESULT', missionId: mission.missionId, taskId: task.taskId, status: task.status, result });

        const existing = mission.tasks.find(t => t.taskId === task.taskId);
        if (existing) Object.assign(existing, task);

        if (!ok && this.retry.shouldRetry(task, mission.retryPolicy)) {
          task.status = 'RETRY';
          const target = mission.tasks.find(t => t.taskId === task.taskId);
          if (target) Object.assign(target, task);
          this.audit.write({ type: 'TASK_RETRY_SCHEDULED', missionId: mission.missionId, taskId: task.taskId, delaySeconds: this.retry.nextDelaySeconds(task, mission.retryPolicy) });
        }
      }

      const statuses = mission.tasks.map(t => t.status);
      if (statuses.every(s => s === 'COMPLETED')) mission.status = 'COMPLETED';
      else if (statuses.some(s => s === 'FAILED')) mission.status = 'FAILED';
      else if (statuses.some(s => s === 'RETRY')) mission.status = 'RETRY';
      else if (statuses.some(s => s === 'BLOCKED')) mission.status = 'BLOCKED';
      else if (statuses.some(s => s === 'ESCALATED')) mission.status = 'ESCALATED';
      else mission.status = 'RUNNING';
      mission.updatedAt = nowIso();

      this.queue.update(mission);
      if (mission.status === 'COMPLETED' || mission.status === 'FAILED') {
        this.audit.write({ type: 'MISSION_KPI', kpi: this.kpi.record(mission) });
      }
    }
    this.persist();
    return this.queue.list();
  }

  listMissions(): Mission[] {
    return this.queue.list();
  }

  private persist(): void {
    this.stateStore.save(this.queue.list());
  }
}
