// ORION models scaffold

export type OrionJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";

export interface OrionOperation {
  missionId?: string;
  taskId?: string;
  action: string;
  scope?: string;
  status: OrionJobStatus;
  requiresApproval?: boolean;
}
