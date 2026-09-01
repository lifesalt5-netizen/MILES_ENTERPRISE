# Sub2Prime™ / Prime-Sub Teaming Intelligence™ — Agreed Design Contract

Status: REQUIRED FOR FULL SYSTEMS GO
Owner: MILES + ORION + relevant teaming/revenue twins
Purpose: Convert a prospect/company profile into evidence-backed prime/team partner targets and concrete relationship actions.

## Product promise
Sub2Prime is not a same-NAICS peer list. It must explain where a target company can fit into a prime contractor's federal delivery ecosystem, based on actual prime/sub history, agencies, awards, vehicles, capability coverage, whitespace, and current/recompete demand.

## Required target-company inputs
- Canonical identity: legal company name, UEI, CAGE when available, website/domain.
- NAICS and adjacent capability/service taxonomy.
- Certifications/set-asides and small-business status.
- Contract vehicles and vehicle gaps.
- Agencies/buyers and federal award history.
- Geography where material.
- Past-performance/proof-of-experience signals.
- Capability keywords/services/products.
- Current/recompete opportunity alignment where available.

Unknown data MUST remain UNKNOWN/UNAVAILABLE and must not be coerced to zero/none.

## Required prime-side inputs
For each candidate prime, where evidence exists:
- Prime identity and UEI.
- Prime award history and agencies/buyers.
- Contract vehicles.
- Historical subcontractors used by the prime.
- Subaward amounts, dates, descriptions, awarding agencies, and prime award IDs.
- Known subcontractor capabilities/NAICS where resolvable.
- Current/recompete awards/opportunities where available.
- Lawfully sourced SBLO/small-business/teaming contact details when available.

## Required matching logic
A prime candidate may be relevant because of one or more of:
1. Agency/buyer overlap.
2. Vehicle overlap or vehicle-access need.
3. Contract/recompete alignment.
4. Capability adjacency.
5. Historical subcontracting pattern.
6. Small-business / certification fit.
7. Geography where relevant.
8. Prime federal scale and subcontracting propensity.
9. Capability whitespace: the prime sells into an agency/contract area but lacks an evidenced subcontractor/partner for a capability the prospect can supply.
10. Replacement/expansion possibility: current historical subs do not cover the prospect's differentiated NAICS/service/capability, or current demand suggests an additional partner is rational.

Different NAICS is NOT a disqualifier. A different NAICS/service can be a positive signal when it fills an evidenced capability gap.

## Required outputs per prime
- Rank.
- Fit score.
- Confidence.
- Why matched, in plain English.
- Agencies/contracts/vehicles that support the fit.
- Historical subcontractors used by the prime, with evidence.
- What those subs appear to cover.
- Capability/partner whitespace, if defensible.
- Why the target company could fit that whitespace.
- Relevant award/subaward history.
- SBLO/teaming contact when lawfully sourced and verified enough to show.
- Recommended next action and outreach reason.
- Evidence/provenance and freshness.

## Commercial preview behavior
The demo must prove value without giving away the entire result set.
- Reveal a small number of real, company-specific prime/team matches.
- Reveal a small number of historical subcontractor relationships where available.
- Lock/grey only additional records that actually exist.
- Never fabricate hidden inventory or fake counts.
- Locked count must equal known remainder after visible preview.
- Modeled candidates must be labeled MODELED_CANDIDATE / VALIDATION_REQUIRED.
- Confirmed historical sub relationships must be visually distinguishable from modeled whitespace.

## Required downstream outputs
- Ranked target-prime list.
- Teaming strategy.
- Outreach tasks.
- CRM account/opportunity/relationship objects.
- Trigger/reason-now for each recommended prime.
- Follow-up path and attribution to appointment/revenue when activated.

## Fail-closed rules
Sub2Prime may not show READY when:
- company identity is ambiguous;
- prime identity is ambiguous;
- a historical subcontractor claim lacks evidence;
- a capability gap is inferred without the supporting prime/sub/award context;
- contact data is invented or not lawfully sourced;
- hidden/locked inventory is fabricated;
- contradictory evidence is unresolved.

## Acceptance tests
FULL PRODUCT ACCEPTANCE requires evidence for all of the following:
1. Target-company inputs resolve from canonical truth.
2. At least one test prime returns actual historical subcontractor records from authoritative/staged USAspending evidence when such records exist.
3. Prime/sub relationships include prime award/subaward identifiers and provenance.
4. A same-capability/NAICS match scores correctly.
5. A different-NAICS capability-whitespace match can score positively when evidence supports it.
6. No different-NAICS match is promoted solely by generic semantic similarity.
7. SBLO/contact fields remain unavailable when not sourced.
8. Teaser/locked counts are exact and no fake inventory is generated.
9. Contradictions fail closed.
10. Demo/API output and downstream CRM representation agree on the same ranked prime candidates.

Until these tests pass against live/staged evidence, Sub2Prime status must remain PARTIAL / RECONSTRUCTION_REQUIRED, never FULLY_READY.
