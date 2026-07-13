import { BusinessGoal } from './MISSION_MODELS';

export class MissionScheduler {
  dueGoals(goals: BusinessGoal[]): BusinessGoal[] {
    return goals.filter(goal => goal.schedule?.enabled !== false);
  }
}
