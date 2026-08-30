# SAM Qualified Universe Cutover Governance

1. Stream the newest full SAM entity extract into a staging-only qualified-company universe.
2. Apply P2GC lead eligibility before contact enrichment or segmentation.
3. Qualified companies without a verified deliverable email remain ENRICHMENT_REQUIRED and are not campaign eligible.
4. Recover email/contact truth in order: prior validated SAM contact, current P2GC internal contact, other P2GC internal source, governed enrichment/Twins. Never fabricate or infer an email.
5. Validate email deliverability and reject institutional/noncommercial domains for outbound.
6. Dedupe and suppress against current send segments; one company may be active in only the highest-priority eligible segment.
7. Promote the newest consolidated SAM universe only after qualification, integrity, contact-gate, dedupe, suppression, and segment validation are green.
8. Keep the prior SAM version available for contact recovery until cutover is verified.
9. After verified cutover, retire superseded active SAM data so exactly one freshest active consolidated SAM universe remains. Preserve source hashes, counts, policy version, and audit provenance.
10. Never delete unrelated historical evidence, campaign data, or non-SAM source families.
