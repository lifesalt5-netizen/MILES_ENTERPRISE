# Demo Truth Integrity Acceptance Contract

Revenue-protection rule: the P2GC client demo must never present missing, zero, none, or contradictory findings merely because different widgets/services read different fields or evidence layers.

## Canonical truth requirements

1. Resolve company identity once (UEI -> CAGE -> canonical domain -> normalized legal name fallback) and carry the selected entity id through the entire demo request.
2. Build one reconciled client truth object before presentation. All demo widgets must read from that object rather than independently inferring material facts.
3. Every material fact must carry source/provenance, observed/freshness timestamp, confidence, and truth class: CONFIRMED, MODELED, UNKNOWN, CONFLICTED, or STALE.
4. Missing/unknown data must remain null/UNKNOWN. Never coerce an absent revenue, award, vehicle, registration, certification, relationship, opportunity, or sales value to zero/none.
5. Zero and NONE may only be displayed when a source capable of proving zero/none has been checked successfully and the result is explicit.
6. GSA status must be reconciled against current authoritative GSA holder/acceptance evidence when available; absence of a GSA-like token in an ORION vehicle field is not proof of no GSA.
7. Federal/SLED sales, award counts, active-contract counts, vehicle counts, buyer relationships, opportunities, recompetes, certifications, and registration status must each have explicit semantic definitions. Award count must not be relabeled as active contracts unless active status is proven.
8. If two current evidence sources disagree on a material fact, the client-facing state is CONFLICTED/REVIEW_REQUIRED, with both evidence items retained for internal review. Do not silently choose one or render both as factual.
9. Modeled competitor, buyer-fit, pathway, leakage, or recommendation outputs must be visibly separated from confirmed factual findings.
10. No client demo may be marked DEMO_READY or full-product GREEN when material contradictions, unresolved identity ambiguity, missing required provenance, stale critical sources, or semantic coercion remain.

## Required acceptance evidence

- deterministic representative-client fixtures covering GSA holder/non-holder, federal revenue present/absent/zero, SLED evidence, multiple vehicles, certifications, active/expired SAM, opportunities/recompetes, buyer history, and conflicting-source cases;
- client-page contract test proving every material card reads the same reconciled truth object;
- explicit tests that absent values render UNKNOWN, not 0/NONE;
- explicit test that awardCount is not presented as activeContracts without active-award evidence;
- explicit GSA reconciliation test against authoritative GSA evidence;
- contradiction test proving CONFLICTED/REVIEW_REQUIRED blocks DEMO_READY;
- live production sample audit with source paths/counts/timestamps and zero unexplained contradictions across the sample.

This contract is a mandatory lane of GitHub issue #423 Full Systems-Go Closeout.