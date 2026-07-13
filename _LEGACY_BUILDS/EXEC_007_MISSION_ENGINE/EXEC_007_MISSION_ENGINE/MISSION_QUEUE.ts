import { Mission, MissionStatus, MissionTask } from './MISSION_MODELS';
import { clone, nowIso } from './MISSION_UTILS';

export class MissionQueue {
  private missions = new Map<string, Mission>();

  enqueue(mission: Mission): Mission {
    const stored = clone(mission);
    stored.updatedAt = nowIso();
    this.missions.set(stored.missionId, stored);
    return clone(stored);
  }

  list(status?: MissionStatus): Mission[] {
    const values = Array.from(this.missions.values());
    return clone(status ? values.filter(m => m.status === status) : values);
  }

  get(missionId: string): Mission | undefined {
    const mission = this.missions.get(missionId);
    return mission ? clone(mission) : undefined;
  }

  update(mission: Mission): Mission {
    mission.updatedAt = nowIso();
    this.missions.set(mission.missionId, clone(mission));
    return clone(mission);
  }

  nextRunnableTasks(missionId: string): MissionTask[] {
    const mission = this.missions.get(missionId);
    if (!mission) return [];
    const completed = new Set(mission.tasks.filter(t => t.status === 'COMPLETED').map(t => t.taskId));
    return clone(mission.tasks.filter(t =>
      ['PENDING', 'RETRY'].includes(t.status) &&
      t.dependencies.every(dep => completed.has(dep)) &&
      !t.governance.approvalRequired
    ).sort((a, b) => a.priority - b.priority));
  }
}
