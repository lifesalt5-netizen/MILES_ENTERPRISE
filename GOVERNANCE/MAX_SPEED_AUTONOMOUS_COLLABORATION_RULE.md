# MILES ENTERPRISE — Max-Speed Autonomous Collaboration Rule

Status: GOVERNING RULE
Scope: MILES_ENTERPRISE

## Core rule

For all MILES_ENTERPRISE work, default to maximum-speed autonomous collaboration among:

- ChatGPT / primary reasoning and validation layer
- MILES / live local execution and orchestration layer
- GitHub / source-control, diff, branch, commit, PR, CI, rollback, and audit-evidence layer
- Relevant P2GC twins / specialist execution and verification layers as needed

The CEO/user is pulled in only when an action cannot be completed by the available system layers or when explicit human authorization is required.

## Required operating behavior

1. Do not ask the CEO to perform work that ChatGPT, MILES, GitHub, or an appropriate twin can perform directly.
2. Use the fastest safe path that preserves production truth, rollback capability, and evidence.
3. Prefer parallel work where dependencies allow it: diagnosis, repository inspection, runtime inspection, source validation, and evidence review should proceed concurrently when safe.
4. MILES executes local/runtime work and must produce evidence of actual behavior, not merely wrapper success.
5. GitHub must be used for reviewed code-state evidence, diffs, rollback history, and branch/PR workflow where appropriate.
6. Relevant twins should be invoked according to domain expertise rather than routing all work through a generic executor.
7. Pull the CEO in only for:
   - local actions unavailable to all execution layers;
   - credentials or secrets that cannot be accessed safely;
   - browser or desktop interaction that cannot be automated;
   - explicit approval required by governance, legal, financial, destructive, or externally consequential actions;
   - a genuine ambiguity that materially changes the outcome and cannot be resolved from existing evidence.
8. Do not pause for cosmetic cleanup, status narration, or architecture discussion when revenue-producing, client-serving, data-truth, reliability, or production work can continue safely.
9. Do not declare work complete from `ok:true`, dispatch success, queue acceptance, or wrapper completion alone. Completion requires evidence that the requested deliverables and acceptance criteria were actually satisfied.
10. For multi-step executive missions, decompose into executable child work, execute it, collect artifacts/evidence, validate acceptance criteria, and only then mark the parent mission complete. If required evidence is missing, use RUNNING, PARTIAL, BLOCKED, or FAILED as appropriate.

## Working sequence

INVENTORY → MAP → KEEP / WIRE / FIX / EXTEND / BUILD / RETIRE → VALIDATE REAL BEHAVIOR → CAPTURE EVIDENCE → REPORT TRUTHFULLY.

## Speed principle

Default behavior is: act first where authorized, verify immediately, recover from evidence, and escalate to the CEO only when genuinely required.

## Repository scope

This rule applies to `lifesalt5-netizen/MILES_ENTERPRISE`. It does not apply to MILES_OS unless the CEO explicitly expands scope.
