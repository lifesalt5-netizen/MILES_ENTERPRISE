# MILES Engineering Full-System Fix Rule

Status: GOVERNING RULE
Owner: MILES Engineering / Digital COO
CEO authority: Kevin
Effective: 2026-08-15

## Rule

When a defect, failure, regression, or production inconsistency is discovered, MILES Engineering must not stop at patching the first visible error. The affected capability must be reviewed end-to-end and all known related defects must be reconciled together before the work is presented as complete.

## Required engineering sequence

1. Define the user/business capability that must work, not merely the exception that appeared.
2. Trace the full execution path: intake, planning, governance, queueing, worker/provider resolution, execution, persistence, result retrieval, API/UI presentation, health, reporting, and recovery where applicable.
3. Inspect dependent runtime state, source-of-truth files, connectors, memory/resource behavior, PM2 lifecycle, locks, queues, and stale artifacts that can affect the same capability.
4. Identify all known related defects before deployment.
5. Prefer canonical corrected implementations or structural transforms over fragile exact-text patching.
6. Preserve backups and rollback evidence before modifying production files.
7. Validate syntax/static integrity for every affected code file.
8. Perform one consolidated deployment for the affected capability wherever practical.
9. Run end-to-end acceptance against the original business objective, including current execution evidence rather than stale historical matches.
10. Do not declare completion because an exception disappeared. Completion requires the full requested capability to pass its acceptance gates.
11. Escalate to the CEO only for material/risky business decisions, external actions, protected approvals, or unavoidable local-machine execution.
12. If validation exposes a genuinely unrelated defect, record it as the next system-level work item rather than reverting to one-error-at-a-time patching.

## Acceptance standard

A production fix is complete only when the relevant path is verified across:

- runtime/service health;
- queue/lock integrity;
- worker/provider/capability resolution;
- source-of-truth correctness;
- execution and persisted result truth;
- API and UI consistency;
- department/report/demo consistency where applicable;
- memory/resource guardrails;
- governance/approval boundaries;
- restart/recovery safety;
- synthetic/test-data exclusion from production executive truth.

## Prohibited completion patterns

The following are not sufficient grounds to declare a fix complete:

- "the error no longer appears";
- "the process restarted";
- "the endpoint returned 200" without validating its content;
- "the command was accepted" without proving queue, worker, persistence, and result retrieval;
- "the dashboard loaded" while it reports stale or divergent truth;
- accepting an old result file as evidence for a newly issued task;
- masking excessive memory consumption with repeated restarts instead of identifying and containing the allocation source.

## Current production-recovery application

The MILES production reconciliation must be treated as one capability spanning TaskQueue locking, PM2/orphan recovery, worker RAM containment, workforce registry loading, canonical revenue truth, 8787 execution/result truth, department state, executive dashboard truth, demo truth, live health, runtime hygiene, and end-to-end acceptance.
