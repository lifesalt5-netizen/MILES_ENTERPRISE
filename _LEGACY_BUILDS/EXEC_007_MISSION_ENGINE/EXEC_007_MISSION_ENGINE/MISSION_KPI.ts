import { Mission, MissionKpiRecord } from './MISSION_MODELS';

export class MissionKpi {
  record(mission: Mission): MissionKpiRecord {
    const started = Date.parse(mission.createdAt);
    const ended = Date.parse(mission.updatedAt);
    const providerUsage: Record<string, number> = {};
    let retryCount = 0;
    for (const task of mission.tasks) {
      providerUsage[task.provider] = (providerUsage[task.provider] ?? 0) + 1;
      retryCount += Math.max(0, task.attemptCount - 1);
    }
    return {
      missionId: mission.missionId,
      name: mission.name,
      category: mission.category,
      status: mission.status,
      durationSeconds: Math.max(0, Math.floor((ended - started) / 1000)),
      retryCount,
      completedTasks: mission.tasks.filter(t => t.status === 'COMPLETED').length,
      failedTasks: mission.tasks.filter(t => t.status === 'FAILED').length,
      providerUsage,
      executiveTimeSavedMinutes: mission.tasks.filter(t => t.status === 'COMPLETED').length * 8,
      revenueImpact: typeof mission.successCriteria.revenue === 'number' ? mission.successCriteria.revenue : undefined,
      operationalImpact: `${mission.tasks.length} operational tasks managed by Miles`,
      recordedAt: new Date().toISOString()
    };
  }
}
