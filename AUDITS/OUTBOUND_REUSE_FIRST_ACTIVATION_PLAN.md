# Outbound Sender Reuse-First Activation Plan

Status: PARALLEL / DO NOT MERGE OR APPLY TO PRODUCTION DURING 24H AUTONOMOUS SOAK

Governing rule: stay on Google Workspace, minimize recurring cost, and do not add paid Workspace seats unless explicitly approved and proven necessary for healthy outbound capacity.

## Current proved state

Instantly observed 10 total accounts: 9 on outreach domains and 1 protected primary-domain account.

Outreach distribution:
- pathwaysgovcon.com: 5 Instantly senders
- pathwaysgsa.com: 3 Instantly senders
- pathwaysgov.com: 1 Instantly sender
- pathways2gc.co: 0
- pathwaysfederal.com: 0
- pathwaystogc.com: 0

Protected primary domain pathways2gc.com remains excluded from outbound.

## Workspace inventory evidenced from Google Admin screenshots during soak

Active users visible:
- pathwaysgovcon.com: cora, evan, maya, silvia, victoria (5)
- pathwaysgsa.com: chris, evan, jake, kevin, ryan (5)
- pathwaysgov.com: aden, alexis, jeff (3)
- pathways2gc.co: none visible
- pathwaysfederal.com: none visible
- pathwaystogc.com: none visible
- pathways2gc.com: info active; silvia archived

No alternate emails were present on kevin@pathwaysgsa.com or aden@pathwaysgov.com when checked.

## DNS readiness observed read-only

- pathwaysfederal.com: Google MX, Google SPF, DMARC present, Google DKIM present => DNS GREEN
- pathwaysgov.com: Google MX, Google SPF, DMARC present, Google DKIM present => DNS GREEN
- pathwaysgsa.com: Google MX, Google SPF, DMARC present, Google DKIM present => DNS GREEN
- pathwaysgovcon.com: Google MX, Google SPF, Google DKIM present, DMARC absent => DNS YELLOW; existing senders remain untouched during soak
- pathways2gc.co: only one Google MX observed, Google SPF and DMARC present, no DKIM found => DNS YELLOW; defer
- pathwaystogc.com: Namecheap registrar-forwarding MX, registrar SPF, no DMARC/DKIM => DNS RED for Google Workspace sender use; defer

## Reuse-first post-soak activation order

1. pathwaysgsa.com
   - Do not create paid users.
   - Reconcile existing Instantly addresses contacts@pathwaysgsa.com and info@pathwaysgsa.com against Workspace configuration.
   - Prefer connecting currently unconnected existing licensed users among chris, evan, jake, kevin, ryan until all five paid users are usable healthy senders.
   - Do not exceed five independent senders on this domain without explicit approval.

2. pathwaysgov.com
   - Do not create paid users.
   - Reconcile kevin@pathwaysgov.com because it exists in Instantly but is not visible in the supplied Workspace user inventory.
   - Prefer connecting aden, alexis, and jeff if appropriate and healthy.
   - Stop when all already-paid independent users that are safe for outbound are connected; do not buy additional seats to force the domain to five.

3. pathwaysgovcon.com
   - Already has five Instantly senders; no mailbox expansion required.
   - Add/repair DMARC only after soak and only through governed change control.

4. pathwaysfederal.com
   - DNS is ready but no paid Workspace users were visible.
   - DEFER. Do not provision new paid seats absent explicit approval and demonstrated capacity need.

5. pathways2gc.co
   - DEFER. Repair/verify MX and DKIM before any sender activation. No paid seat creation without explicit approval.

6. pathwaystogc.com
   - DEFER. Current MX is registrar forwarding, not Google Workspace. Do not migrate routing or purchase users absent explicit approval and demonstrated capacity need.

## Acceptance rule

The next sender-capacity milestone is not a fixed 30-mailbox count. It is:

REUSE_FIRST_SENDER_CAPACITY_GREEN = all already-paid, independently usable Google Workspace outreach accounts that pass DNS/authentication/Instantly health have been connected and governed, with no unnecessary new recurring seat cost.

After this milestone, additional paid seats require explicit CEO approval based on measured capacity need, deliverability, meetings, and revenue performance.

## Safety

- No production changes during the running 24-hour autonomous soak.
- No new paid Google Workspace users without explicit approval.
- No primary-domain outbound from pathways2gc.com.
- No aliases treated as independent senders unless Instantly supports them with truly separate mailbox authentication and sender reputation; do not assume aliases equal independent capacity.
- Preserve SPF/DKIM/DMARC correctness and reply ingestion before increasing volume.
