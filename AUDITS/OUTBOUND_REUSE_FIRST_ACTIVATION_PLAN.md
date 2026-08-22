# Outbound Sender Reuse-First Activation Plan

Status: ACTIVE CLEAN-SOAK PREP

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

## Workspace inventory evidenced from Google Admin screenshots

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
- pathwaysgovcon.com: Google MX, Google SPF, Google DKIM present, DMARC absent => DNS YELLOW
- pathways2gc.co: only one Google MX observed, Google SPF and DMARC present, no DKIM found => DNS YELLOW
- pathwaystogc.com: Namecheap registrar-forwarding MX, registrar SPF, no DMARC/DKIM => DNS RED for Google Workspace sender use

## Clean-soak readiness order

1. pathwaysgovcon.com
   - Keep the five existing Instantly senders unchanged for the clean soak.
   - DMARC remains a deliverability hardening item, but do not alter DNS unless the change can be completed and verified before restarting acceptance.

2. pathwaysgsa.com
   - Do not create paid users.
   - Reconcile contacts@pathwaysgsa.com and info@pathwaysgsa.com against Workspace configuration.
   - Existing paid users chris, evan, jake, kevin, and ryan are the only expansion pool unless additional spend is explicitly approved.
   - Do not add new senders immediately before the clean soak unless authentication, warmup, reply routing, and health are proven first.

3. pathwaysgov.com
   - Do not create paid users.
   - Reconcile kevin@pathwaysgov.com because it exists in Instantly but was not visible as a primary Workspace user in the supplied inventory.
   - Existing paid users aden, alexis, and jeff are the only expansion pool unless additional spend is explicitly approved.
   - Do not add new senders immediately before the clean soak unless authentication, warmup, reply routing, and health are proven first.

4. pathwaysfederal.com
   - DNS is ready but no paid Workspace users were visible.
   - Do not provision new paid seats absent explicit approval and demonstrated capacity need.

5. pathways2gc.co
   - Repair/verify MX and DKIM before any future sender activation.
   - No paid seat creation without explicit approval.

6. pathwaystogc.com
   - Current MX is registrar forwarding, not Google Workspace.
   - Do not migrate routing or purchase users absent explicit approval and demonstrated capacity need.

## Acceptance rule

REUSE_FIRST_SENDER_CAPACITY_GREEN = actual healthy, independently authenticated outreach accounts are measured truthfully; protected pathways2gc.com is excluded from outbound; existing paid Workspace capacity is reused before any new recurring seat cost; no arbitrary sender-count target is imposed.

Sender expansion is not required merely to start a clean autonomous soak. New or newly connected senders must not be introduced immediately before the soak unless they have already passed authentication, warmup, reply-ingestion, and sending-governance checks.

## Safety

- No new paid Google Workspace users without explicit approval.
- No primary-domain outbound from pathways2gc.com.
- No aliases treated as independent senders unless Instantly supports them with truly separate mailbox authentication and sender reputation.
- Preserve SPF/DKIM/DMARC correctness and reply ingestion before increasing volume.
- Prefer a stable known-good sender set for the clean 24-hour soak over capacity expansion that introduces new variables.
