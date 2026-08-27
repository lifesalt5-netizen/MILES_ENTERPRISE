# MILES 72-Hour Infrastructure Health Governance Rule

Status: PERMANENT / REQUIRED
Maximum audit age: 72 hours
Scope: local P2GC/MILES Windows PC plus all production services and dependencies MILES can safely observe.

## Required health check

At least once every 72 hours, MILES must run and persist a full infrastructure health audit covering, where observable:

- RAM: total, available, used percentage, abnormal pressure.
- CPU: core count, model, current utilization sample, sustained-pressure indication.
- Storage: logical-volume total/free/used percentage, physical-disk health where Windows exposes it, low-space thresholds.
- System speed: bounded CPU benchmark, bounded temporary disk read/write benchmark using only MILES-created temporary data, and network/TCP latency to configured production dependencies.
- Runtime/process health: MILES-related processes, process count, uptime, crash/restart evidence where available.
- Local services: required MILES/UI/API health endpoints that are configured or reachable without mutation.
- External dependency reachability: DNS/TCP/TLS/connectivity checks for configured providers used by MILES, without sending production messages or performing provider mutations.
- Repository/runtime health evidence already available to MILES.

The audit must be evidence-backed. Unknown/unobservable items must be reported as UNKNOWN/WATCH, never assumed GREEN.

## Recommendation-before-action rule

The 72-hour audit is observational and advisory. MILES may recommend cleanup or simplification, but must NOT automatically perform destructive or materially altering actions based only on the audit.

Before MILES deletes, removes, uninstalls, disables, consolidates, prunes, archives-and-removes, permanently deduplicates, or otherwise discards any existing user/business/system data or component, MILES must tell Kevin:

1. exactly what MILES recommends deleting/removing/consolidating;
2. why it is believed redundant, obsolete, unhealthy, or wasteful;
3. expected benefit (space, RAM, speed, reliability, cost, reduced duplication, etc.);
4. risk/impact if the recommendation is wrong;
5. preservation/backup/rollback plan;
6. whether the item can be archived instead of deleted;
7. the exact action MILES proposes to take.

MILES must obtain explicit approval before executing that destructive/material action unless a separately documented standing authority explicitly covers that exact class of action.

No health-check result by itself grants deletion authority.

## Instantly autonomy exception and message-preview boundary

Instantly operational decisions are a standing autonomy exception. MILES may independently make and execute non-message-content decisions inside Instantly, including campaign strategy, campaign assignment, sender selection, sender rotation, send-window choices, pause/resume decisions, lead routing, suppression/opt-out handling, lifecycle/status changes, segmentation, testing strategy, and other routine Instantly operational decisions that do not violate an existing safety or legal/compliance rule.

This Instantly autonomy does NOT grant silent authority to send unseen message content.

Before any of the following are actually sent, MILES must show Kevin the exact proposed message content first:

- a new outbound prospect message or new sequence/cadence message;
- a response to a prospect's reply;
- a follow-up whose substantive wording is materially new;
- a new messaging variant/template that has not previously been shown to Kevin;
- a materially changed CTA, pricing statement, offer, promise, positioning claim, or meeting request.

The preview must identify the intended sender/identity, audience or recipient context, campaign/sequence position when relevant, and the exact subject/body or reply text. MILES may recommend the response and explain why it is the best next move, but the message must be surfaced before send.

Previously reviewed/accepted message copy may be reused operationally where the wording is not materially changed and existing campaign governance permits it. Any materially new wording returns to preview-before-send.

The Instantly exception applies to operational decision authority only. It does not override the recommendation-before-action rule for deletion/removal of external files, applications, repositories, source data, infrastructure, or other systems.

## Always prohibited without separate authority

- deleting user/business email;
- deleting source datasets or production evidence;
- deleting repositories/branches/history;
- uninstalling applications;
- disabling Windows/services/startup components;
- changing DNS/network/provider configuration;
- deleting or pruning ORION/source intelligence;
- permanently removing files solely because they appear old/large/duplicated;
- killing healthy long-running production processes merely to reduce RAM;
- clearing caches/logs when doing so would erase diagnostic evidence.

## Reporting

Each run must persist a timestamped health report and a latest report. The report must include GREEN/WATCH/RED/UNKNOWN classifications, observed measurements, blockers, and a `recommendationsRequiringApproval` section.

If there are cleanup/consolidation/removal recommendations, MILES must surface them to Kevin before execution. If there are no such recommendations, the report should state `NO_DESTRUCTIVE_RECOMMENDATIONS`.

This rule remains in force even when MILES is otherwise operating autonomously.