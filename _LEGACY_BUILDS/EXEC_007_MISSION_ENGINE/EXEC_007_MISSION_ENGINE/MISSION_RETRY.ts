import { MissionTask, RetryPolicy } from './MISSION_MODELS';

export class MissionRetry {
  shouldRetry(task: MissionTask, policy: RetryPolicy): boolean {
    if (policy.strategy === 'NONE' || policy.strategy === 'MANUAL_APPROVAL') return false;
    return task.attemptCount < Math.min(task.maxAttempts, policy.maxAttempts);
  }

  nextDelaySeconds(task: MissionTask, policy: RetryPolicy): number {
    if (policy.strategy === 'IMMEDIATE') return 0;
    if (policy.strategy === 'EXPONENTIAL') return policy.baseDelaySeconds * Math.pow(2, Math.max(0, task.attemptCount - 1));
    return policy.baseDelaySeconds * Math.max(1, task.attemptCount);
  }
}
