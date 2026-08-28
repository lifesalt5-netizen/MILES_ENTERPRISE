# P2GC / MILES ALL SYSTEMS GO Acceptance Standard

Status: **GOVERNING**  
Machine-readable source: `DATA/governance/all_systems_go_acceptance_rules.json`

## Fastest safe path rule

For every task, test, fix, validation, recovery, and acceptance sequence, MILES must take the **fastest safe, evidence-backed path to verified completion**.

This means:

- prefer the shortest execution path that can truthfully satisfy the governing acceptance criteria;
- avoid duplicate reads, duplicate tests, unnecessary branches, repeated polling, redundant audits, and manual CEO steps when an automated governed path exists;
- parallelize independent safe workstreams when doing so cannot corrupt shared state or weaken evidence;
- reuse current valid evidence instead of regenerating it unless a material change invalidated that evidence;
- make the smallest bounded root-cause fix rather than broad rewrites when a smaller fix is sufficient;
- use fixed governed automation instead of asking the CEO to operate shells or provider consoles when the system can act safely itself;
- stop exploring alternatives once one path is proven sufficient and safe.

Speed never authorizes skipping a required safety boundary, authoritative-source reconciliation, production proof, fail-closed check, recovery proof, or final regression. The governing priority is **fastest path that still produces valid GREEN evidence**, not fastest path to an optimistic status.

## Meaning of ALL SYSTEMS GO

`ALL_SYSTEMS_GO` is a production-readiness declaration, not a code-completeness statement. Every production-critical subsystem must be individually proven and then included in a current-main end-to-end regression.

A subsystem may be marked **GREEN / GO** only when it is:

1. **Functional** — it actually runs and produces the intended result.
2. **Accurate** — its output reconciles to the authoritative underlying source.
3. **Real** — no mock, demo, synthetic, placeholder, stale fallback, or fabricated value is presented as production truth.
4. **Fresh** — evidence and data are current enough for the subsystem's purpose.
5. **End-to-end** — the full path from input through processing to output works.
6. **Autonomous where applicable** — normal operation does not require CEO shell administration.
7. **Recoverable where applicable** — a controlled failure/recovery test demonstrates that the governed recovery mechanism actually restores service.
8. **Fail-closed** — missing or uncertain critical data becomes UNKNOWN/WATCH/RED instead of falsely looking healthy.
9. **Safe** — governance boundaries are enforced and unauthorized mutations do not occur.
10. **Repeatable** — the proof can be rerun with the same governing logic.
11. **Evidence-backed** — timestamped evidence identifies what was tested and what source supports the result.

`NOT_APPLICABLE_WITH_REASON` may be used for an individual criterion only when the criterion genuinely does not apply to that subsystem and the manifest contains a specific reason. It may not be used to bypass a failed or unproven required behavior.

## Mandatory fix/test loop

Every material fix follows this sequence, using the fastest safe execution path and parallelizing independent steps where possible:

1. Observe the failure and retain evidence.
2. Isolate the root cause.
3. Make the smallest bounded fix that resolves the root cause without weakening safety.
4. Run syntax/static/contract checks.
5. Run component tests.
6. Run production or production-equivalent proof.
7. Exercise the failure/recovery path when the subsystem has recovery behavior.
8. Reconcile output to the authoritative source.
9. Verify fail-closed behavior for missing/uncertain data.
10. Write timestamped evidence.
11. Rerun affected end-to-end regression.
12. Mark GREEN only after all applicable requirements pass.

A later material change invalidates earlier acceptance evidence for any affected path until the regression is rerun.

## What never counts as GREEN by itself

- A file or implementation exists.
- CI passes without production proof.
- A database opens but freshness/provenance is unproven.
- An email is delivered but inbox placement is unproven.
- A dashboard displays a value that has not been reconciled to the authoritative source.
- A tab/button/link exists but the route or interaction has not been exercised.
- A watchdog is installed but has not demonstrated independent recovery.
- A UI badge says READY/LIVE/GREEN without supporting evidence.
- A file timestamp changes without a genuine underlying data refresh.
- Mock/demo/synthetic/default data silently appears as production truth.
- Unknown critical data silently defaults to zero or healthy.
- Normal recovery requires the CEO to run shell commands.

## Required final gates

The machine-readable rule file is authoritative for the complete gate list. It includes MILES core runtime; autonomous ownership; independent watchdog recovery; GitHub bridge; repository/capability integrity; ORION core, freshness and derived intelligence; Instantly/outbound lifecycle; inbox placement and sender authentication; IONOS; Calendly; send-window governance; CRM and revenue truth; company/client health; infrastructure and its autonomous scheduler; the MILES Executive Dashboard and **every associated tab/surface**; Prospect Demo; Sub2Prime; Opportunities; Vehicles; Recompetes; Proposal Command; MILES command surface; approvals; safety; failure handling; final current-main regression; and the canonical final manifest.

### Executive Dashboard special rule

The Executive Dashboard cannot be GREEN because its server starts or because `/api/state` returns JSON. Before it is accepted:

- the production dashboard must load;
- every displayed metric must be traced to and reconciled with its authoritative source;
- refresh behavior must produce current state;
- stale/error states must be visible and truthful;
- the MILES command channel must reach the governed execution backend;
- every current dashboard link/tab must load without dead routes;
- each linked product must perform its intended interaction;
- each LIVE/READY/BETA/ACTIVE label must accurately reflect the tested acceptance state;
- demo or sample data may only appear when explicitly labeled as demo/sample and must never substitute for production truth.

## Final declaration invariant

The system may emit **P2GC / MILES — ALL SYSTEMS GO** only when the canonical final manifest shows:

- overall status = `ALL_SYSTEMS_GO`;
- every required gate = `GREEN`;
- blockers = `0`;
- unproven critical gates = `0`;
- mock/demo values presented as production truth = `0`;
- unauthorized mutations = `0`;
- CEO/manual recovery dependencies = `0`, excluding deliberate CEO approval decisions required by governance;
- each gate contains evidence references and all applicable criteria are GREEN;
- the final regression was run against current `main` and current production after the last material change.

If any one of these conditions is not true, the final status must remain `NOT_ALL_SYSTEMS_GO`, `WATCH`, or `RED` as appropriate.
