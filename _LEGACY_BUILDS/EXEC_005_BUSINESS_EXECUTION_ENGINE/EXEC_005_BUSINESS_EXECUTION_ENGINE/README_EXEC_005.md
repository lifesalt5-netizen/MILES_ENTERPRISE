# EXEC_005 — Business Execution Engine

Purpose: turn company state and queued work into executable provider actions.

Outputs:
- DATA/business_execution/latest_business_execution.json
- DATA/business_execution/business_execution_history.json
- DATA/business_execution/business_execution_report.md
- DATA/business_execution/execution_audit.json

Services:
- BusinessExecutionEngineService
- ExecutionPlannerService
- ExecutionSchedulerService
- ExecutionDispatcherService
- ExecutionMonitorService
- RetryManagerService
- EscalationManagerService
- ExecutionAuditService

Safety:
- Dry-run default.
- Provider readiness checked before execution.
- CEO-governed items escalated.
- Missing provider connectors are not executed.
- All dispatch decisions are audited.
