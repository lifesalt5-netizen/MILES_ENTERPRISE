# MILES Engineering Full-System Fix Rule

Status: GOVERNING RULE
Owner: MILES Engineering / Digital COO
CEO authority: Kevin
Effective: 2026-08-15

## Rule

When a defect, failure, regression, or production inconsistency is discovered, MILES Engineering must not stop at patching the first visible error. The affected capability must be reviewed end-to-end and all known related defects must be reconciled together before the work is presented as complete.

The CEO is not the engineering test harness. MILES owns reproduction, diagnosis, repair, regression testing, self-healing deployment logic, and acceptance. CEO involvement is reserved for unavoidable execution on the CEO-owned machine, protected approvals, or material business decisions.

## Required engineering sequence

1. Define the user/business capability that must work, not merely the exception that appeared.
2. Reproduce the reported failure in an isolated or simulated environment whenever technically possible before changing production behavior.
3. Trace the full execution path: intake, planning, governance, queueing, worker/provider resolution, execution, persistence, result retrieval, API/UI presentation, health, reporting, and recovery where applicable.
4. Inspect dependent runtime state, source-of-truth files, connectors, memory/resource behavior, PM2 lifecycle, locks, queues, and stale artifacts that can affect the same capability.
5. Identify all known related defects before deployment.
6. Prefer canonical corrected implementations or structural transforms over fragile exact-text patching.
7. Preserve backups and rollback evidence before modifying production files.
8. Validate syntax/static integrity for every affected code file.
9. Add or update a regression test that reproduces the discovered failure mode and proves the repair.
10. For Windows production paths, pass a Windows validation gate before presenting the repair to the CEO whenever GitHub Actions or equivalent validation is available.
11. Make runtime reconciliation idempotent and self-healing for known recoverable drift, including stale PM2 identities, duplicate script registrations, stale locks, and process-state mismatches.
12. Perform one consolidated deployment for the affected capability wherever practical.
13. Run end-to-end acceptance against the original business objective, including current execution evidence rather than stale historical matches.
14. Do not declare completion because an exception disappeared. Completion requires the full requested capability to pass its acceptance gates.
15. Escalate to the CEO only for material/risky business decisions, external actions, protected approvals, or unavoidable local-machine execution.
16. If validation exposes a genuinely unrelated defect, record it as the next system-level work item rather than reverting to one-error-at-a-time patching.

## Required MILES production acceptance

For the current MILES production architecture, PASS requires all applicable surfaces to be verified as current and operational:

- canonical PM2 process identity and online state;
- standalone MILES API;
- lean worker runtime;
- MILES Command Center;
- CEO Executive Dashboard;
- Desktop UI;
- Autonomous COO loop;
- command intake through the CEO surface;
- TaskQueue bridge and worker execution;
- persisted result truth tied to the current task/operation;
- real-prospect Executive Government Growth Blueprint demo;
- final cross-surface truth gate;
- saved PM2 process map and restart safety.

A final script or dashboard must not print or display PASS for a surface that was merely assumed, preserved from an older process, or checked only by TCP reachability.

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
- masking excessive memory consumption with repeated restarts instead of identifying and containing the allocation source;
- asking the CEO to repeatedly run diagnostic commands that MILES could have reproduced, simulated, or regression-tested first;
- using `-f`, duplicate process creation, or destructive PM2 resets as a substitute for canonical process identity reconciliation;
- declaring a final system PASS while a required surface is only labeled "preserved" or was not directly tested.

## Current production-recovery application

The MILES production reconciliation must be treated as one capability spanning TaskQueue locking, canonical PM2 identity by script path/name/arguments, orphan recovery, worker RAM containment, workforce registry loading, canonical revenue truth, 8787 execution/result truth, 8737 CEO command execution, 3737 Desktop UI, Autonomous COO loop health, department state, executive dashboard truth, real-prospect demo truth, live health, runtime hygiene, and end-to-end acceptance.

The canonical recovery entrypoint must remain safe to rerun. Known recoverable process drift must be repaired automatically before business acceptance begins.
