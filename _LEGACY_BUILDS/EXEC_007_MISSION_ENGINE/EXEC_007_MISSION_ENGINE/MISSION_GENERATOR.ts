import { BusinessGoal, CompanyStateSnapshot, Mission } from './MISSION_MODELS';
import { MissionPlanner } from './MISSION_PLANNER';

export class MissionGenerator {
  constructor(private planner = new MissionPlanner()) {}

  generate(goals: BusinessGoal[], state: CompanyStateSnapshot): Mission[] {
    return goals.map(goal => this.planner.plan(goal, state));
  }
}
