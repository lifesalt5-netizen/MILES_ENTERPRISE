# BUILD 126A â€” EXECUTIVE DECISION ENGINE

## Objective

Replace fixed, hard-coded mission prioritization with a centralized Executive Decision Engine while preserving the existing workflow, capability, queue, governance, execution, and verification systems.

## Architectural Boundary

Do not redesign:

- CapabilityService
- WorkflowService
- WorkQueueService
- ExecutionService
- Existing governance protections
- Existing provider integrations

## Required New Service

Create:

`SERVICES/ExecutiveDecisionEngine.js`

## Required Behavior

1. Normalize all candidate missions.
2. Deduplicate semantically equivalent missions.
3. Score each mission.
4. Rank all missions in one executive agenda.
5. Explain the score and ranking.
6. Identify protected actions.
7. Return autonomous and approval-required counts.
8. Preserve candidate metadata.
9. Limit the final agenda to the highest-value actionable missions.
10. Never allow routine maintenance to outrank critical revenue, client, deadline, security, or deliverability work without an explicit score-based reason.

## Initial Scoring Factors

- Revenue impact: 30%
- Urgency: 20%
- Customer or client impact: 15%
- Strategic value: 15%
- Operational risk reduction: 10%
- Execution confidence: 10%

## Acceptance Tests

1. A positive qualified reply outranks routine ORION refresh work.
2. A proposal due within eight hours outranks ordinary outbound maintenance.
3. A critical deliverability threat outranks increasing campaign volume.
4. A mandatory qualification failure prevents a proposal mission from being ranked as a prime submission action.
5. Protected actions are marked `requiresKevin: true`.
6. Semantically duplicate missions appear only once.
7. Every ranked item contains a human-readable explanation.
8. Existing workflow and execution tests continue to pass.
9. The service passes `node --check`.
10. AutonomousCOOLoopService completes a cycle using the ranked agenda.
