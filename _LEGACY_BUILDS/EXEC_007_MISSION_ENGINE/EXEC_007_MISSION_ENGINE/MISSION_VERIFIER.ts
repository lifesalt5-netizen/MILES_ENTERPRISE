import { ExecutionResult, MissionTask } from './MISSION_MODELS';

export class MissionVerifier {
  verify(task: MissionTask, result: ExecutionResult): boolean {
    if (!task.verification.required) return true;
    if (!result.accepted || result.status === 'FAILED' || result.status === 'REJECTED') return false;
    if (task.verification.method === 'NONE') return true;
    return ['QUEUED', 'COMPLETED'].includes(result.status);
  }
}
