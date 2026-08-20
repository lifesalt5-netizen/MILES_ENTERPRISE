# MILES Full Product Functional Acceptance — 2026-08-20

## Acceptance standard

A product is not READY because a process is online or a route returns HTTP 200. READY requires the user-facing action to open, reach its backend dependency, return the requested semantic result, preserve evidence and fail closed when evidence is absent.

## Required surfaces

1. Executive Government Growth Blueprint demo
2. Sub2Prime / Prime-Sub Teaming Intelligence
3. Opportunity Intelligence
4. Vehicle Intelligence
5. Recompete Intelligence
6. MILES Execution / Command Center
7. Customer / Revenue Operations
8. Legacy Diagnostics
9. Executive brief refresh/state surfaces
10. Capture Capacity / CURRENTLY_LOOKING_FOR_HELP revenue discovery

## Required test classes

For every applicable product:
- route/service availability
- backend dependency closure
- representative positive result
- result-shape validation
- semantic/result-quality validation
- evidence/disclosure validation
- negative/fail-closed behavior

For MILES Execution specifically:
- CEO command planning
- source-closure preflight
- capability resolution
- BusinessOperationsBridge handoff
- canonical TaskQueue acceptance
- worker execution contract
- structured error visibility

For CURRENTLY_LOOKING_FOR_HELP:
- source discovery
- evidence-backed current need
- contact-to-signal identity matching
- qualification gate
- suppression before external action
- governed staging
- no autonomous live campaign activation

## Defects proven by production acceptance

### Capture discovery path array crash
`Array.map(path.resolve)` passed map callback metadata into `path.resolve`, causing `paths[2]` to receive the source array. Corrected at the shared discovery service boundary.

### CEO command preflight source-closure failure
`CommandPreflightService` requires `CONFIG/PRODUCTION_SYSTEM_GRAPH.json`; it was absent from production main. A canonical graph is now version-controlled and regression-tested.

### CEO revenue mission semantic mismatch
Broad revenue missions previously produced only Instantly inventory reads. Capture/prospect missions now route to the existing governed Capture Capacity revenue execution lane via a canonical MILES action. Campaign auto-activation remains forbidden.

### Opaque Command Center error display
The browser previously discarded structured backend failure payloads and displayed only an HTTP status message. It now preserves and renders the backend status/blocker details.

## Release rule

This change is not accepted for production until the full product semantic acceptance suite, Capture Capacity regression suite, single-owner regressions, and runtime stability contract are green.

## Live acceptance after deployment

CI proves semantic contracts with controlled fixtures. Production acceptance must then exercise the actual localhost surfaces and real ORION/Instantly data. No send, campaign activation, or external write is considered complete without live provider evidence.

## Email operations

IONOS inbound spam filtering is a separate external mailbox control plane. MILES should classify inbound/reply evidence without fabricating legitimacy, but IONOS anti-spam/catch-all/allowlist settings require either a compatible connector or a direct IONOS settings pass. No compatible IONOS/IMAP plugin was available during this audit.
