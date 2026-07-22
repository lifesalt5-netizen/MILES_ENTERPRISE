BUILD E001 — EMAIL OPERATIONS MANAGER

Create:

SERVICES/email_operations/EmailOperationsManager.js
tests/email_operations_manager.test.js

Purpose:
Create the orchestration layer for outbound email operations.

Do not modify:
- ExecutiveDecisionEngine
- ExecutiveContextService
- ExecutiveMemoryService
- WorkflowService
- WorkQueueService
- Existing providers

The service must expose:

getEmailOperationsStatus()
auditInfrastructure()
auditCampaigns()
auditMailboxes()
auditDomains()
auditDeliverability()
auditSegments()
auditCapacity()
generateExecutiveSummary()
generateRecommendedActions()

Return a status object containing:

{
  infrastructure,
  campaigns,
  mailboxes,
  domains,
  dns,
  deliverability,
  segments,
  capacity,
  recommendations,
  executiveSummary
}

Rules:
- Do not add provider-specific logic.
- Delegate to existing providers when available.
- If one provider fails, continue the remaining audits.
- Mark failed sections degraded.
- Never throw an uncaught exception.

Tests must verify:
- service initializes
- provider failure is handled
- status is generated
- recommendations are generated
- executive summary is generated

Run:
node --check SERVICES/email_operations/EmailOperationsManager.js
node --test tests/email_operations_manager.test.js

Return:
- files created
- tests passed
- blockers
