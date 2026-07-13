import { ExecutionResult, MissionTask } from './MISSION_MODELS';

export interface BusinessExecutionEngineAdapter {
  submitTask(task: MissionTask): Promise<ExecutionResult>;
}

export class DryRunExecutionAdapter implements BusinessExecutionEngineAdapter {
  async submitTask(task: MissionTask): Promise<ExecutionResult> {
    if (task.status === 'BLOCKED' || task.status === 'ESCALATED') {
      return { accepted: false, status: 'REJECTED', message: task.governance.reason };
    }
    return {
      accepted: true,
      status: 'QUEUED',
      auditId: `AUDIT_${task.taskId}`,
      message: `Task accepted by Business Execution Engine adapter: ${task.capability}`
    };
  }
}
