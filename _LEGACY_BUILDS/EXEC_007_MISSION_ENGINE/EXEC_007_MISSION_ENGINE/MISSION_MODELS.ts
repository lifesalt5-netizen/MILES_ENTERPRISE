export type MissionStatus = 'PENDING' | 'RUNNING' | 'WAITING' | 'RETRY' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'ESCALATED';
export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'RETRY' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'ESCALATED';
export type MissionCategory = 'REVENUE' | 'SALES' | 'MARKETING' | 'WEBSITE' | 'ORION' | 'ADMINISTRATION' | 'CLIENT_OPERATIONS';
export type RetryStrategy = 'NONE' | 'IMMEDIATE' | 'LINEAR' | 'EXPONENTIAL' | 'MANUAL_APPROVAL';
export type ScheduleMode = 'CONTINUOUS' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'EVENT_DRIVEN' | 'PROVIDER_TRIGGERED';

export interface GovernanceDecision {
  allowed: boolean;
  approvalRequired: boolean;
  reason: string;
  approvalCategory?: 'PRICING' | 'CONTRACTS' | 'HIRING' | 'LEGAL' | 'PARTNERSHIPS' | 'STRATEGIC_DECISION';
}

export interface RetryPolicy {
  strategy: RetryStrategy;
  maxAttempts: number;
  baseDelaySeconds: number;
}

export interface VerificationPolicy {
  required: boolean;
  method: 'READ_PROVIDER' | 'CHECK_STATE' | 'CHECK_FILE' | 'CHECK_DASHBOARD' | 'MANUAL_APPROVAL' | 'NONE';
  expected?: Record<string, unknown>;
}

export interface MissionSchedule {
  mode: ScheduleMode;
  cron?: string;
  eventName?: string;
  enabled: boolean;
}

export interface MissionTask {
  taskId: string;
  missionId: string;
  name: string;
  provider: string;
  capability: string;
  parameters: Record<string, unknown>;
  dependencies: string[];
  priority: number;
  status: TaskStatus;
  attemptCount: number;
  maxAttempts: number;
  verification: VerificationPolicy;
  governance: GovernanceDecision;
  auditId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Mission {
  missionId: string;
  name: string;
  category: MissionCategory;
  priority: number;
  status: MissionStatus;
  objective: string;
  owner: 'MILES' | 'KEVIN' | 'SYSTEM';
  createdAt: string;
  updatedAt: string;
  schedule: MissionSchedule;
  successCriteria: Record<string, unknown>;
  governanceRequired: boolean;
  retryPolicy: RetryPolicy;
  verificationPolicy: VerificationPolicy;
  tasks: MissionTask[];
  sourceGoalId?: string;
}

export interface BusinessGoal {
  goalId: string;
  name: string;
  category: MissionCategory;
  objective: string;
  priority: number;
  target?: Record<string, unknown>;
  schedule?: MissionSchedule;
}

export interface ProviderReadiness {
  provider: string;
  status: 'READY' | 'READY_READ_ONLY' | 'NOT_CONFIGURED' | 'ERROR' | 'DISABLED';
  capabilities: string[];
  controlledWritesEnabled: boolean;
}

export interface CompanyStateSnapshot {
  timestamp: string;
  revenueGoal?: number;
  clientGoal?: number;
  callsGoal?: number;
  proposalsGoal?: number;
  providers: ProviderReadiness[];
  activeCampaigns?: string[];
  segmentInventory?: Array<Record<string, unknown>>;
}

export interface ExecutionResult {
  accepted: boolean;
  status: 'QUEUED' | 'REJECTED' | 'COMPLETED' | 'FAILED';
  auditId?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface MissionKpiRecord {
  missionId: string;
  name: string;
  category: MissionCategory;
  status: MissionStatus;
  durationSeconds: number;
  retryCount: number;
  completedTasks: number;
  failedTasks: number;
  providerUsage: Record<string, number>;
  executiveTimeSavedMinutes: number;
  revenueImpact?: number;
  operationalImpact: string;
  recordedAt: string;
}
