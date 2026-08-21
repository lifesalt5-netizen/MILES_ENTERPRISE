# Guarded Autonomous Reply Send

This change restores the missing canonical reply-send capability on current `main` without merging the obsolete Aug. 9-10 stacked PR chain.

The connector accepts `replyToEmail`, plus `sendReply` / `reply` aliases through the canonical action contract. It requires `eaccount`, `reply_to_uuid`, `subject`, and either `body.text` or `body.html`.

Live execution remains blocked unless all four safety gates are explicitly enabled:

- `MILES_DRY_RUN=false`
- `MILES_ALLOW_INSTANTLY_MUTATIONS=true`
- `MILES_CONTROLLED_WRITE_ENABLED=true`
- `INSTANTLY_WRITE_ENABLED=true`

The qualified-reply policy permits only `INTERESTED`, `MEETING`, `PRICING`, and `REFERRAL` at confidence >= 0.90, with a reply UUID, sender account, and no suppression/opt-out evidence.

This PR does not enable those environment gates and therefore does not send live replies by itself. Its purpose is to remove the missing execution capability while preserving fail-closed governance so the existing reply-intelligence workflow can be wired into autonomous follow-up next.
