# P2GC SAM Refresh Retention, Deduplication, and Email Rules

1. The full SAM.gov public entity extract is a raw source, not outbound lead inventory.
2. Build and validate the new consolidated qualified SAM company universe under the canonical P2GC lead eligibility policy before replacing any existing SAM-derived lead universe.
3. After the new consolidated universe is validated as complete enough for production use, retire/remove superseded prior SAM source/consolidated copies from the active MILES/P2GC data path so exactly one active consolidated SAM universe remains: the freshest validated version. Preserve only required provenance/audit metadata, not duplicate active lead universes.
4. Segment the freshest consolidated qualified universe using existing P2GC segment governance and deduplicate against all current active send segments. A company may qualify for multiple segments, but only the highest-priority active segment owns outbound execution.
5. Company deduplication and contact deduplication are separate controls. Global suppression remains authoritative and suppressed companies/emails may not automatically re-enter outbound.
6. Every outbound-eligible lead must have a verified deliverable commercial email. Missing email does not disqualify an otherwise valid company; it routes the company to enrichment and blocks campaign eligibility until resolved.
7. Email enrichment order should reuse known internal truth before external discovery: current master contact index / prior validated SAM-derived contacts / other existing P2GC datasets and CRM-like internal sources / governed enrichment methods. Preserve source provenance and last-verification date for the selected contact.
8. Do not fabricate or infer unverified addresses. Institutional domains (.gov, .mil, .edu and other noncommercial domains excluded by policy) are not campaign-eligible contacts.
9. After enrichment, run email verification, suppression, company/contact dedupe, segment ownership, and active-campaign collision checks before upload or send eligibility.
10. Report waterfall counts: raw SAM records -> qualified companies -> deduped companies -> already-owned by higher-priority segment -> missing email -> email enriched -> verified email -> suppressed -> final campaign-eligible leads.
