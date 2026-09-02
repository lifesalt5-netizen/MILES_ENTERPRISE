# Outbound Sender Zero-Cost Capacity Full-Go Plan

Status: P0 FULL-GO BLOCKER

Governing rule: stay on Google Workspace, add **zero new recurring Workspace license cost**, and use every already-paid independent outreach mailbox that can safely pass authentication, warmup, reply-routing, and live inbox-placement governance. Aliases do not count as independent sending capacity.

## Current proved baseline

Instantly previously observed 10 total accounts: 9 on outreach domains and 1 protected primary-domain account.

Outreach distribution at that baseline:
- pathwaysgovcon.com: 5 Instantly senders
- pathwaysgsa.com: 3 Instantly senders
- pathwaysgov.com: 1 Instantly sender
- pathways2gc.co: 0
- pathwaysfederal.com: 0
- pathwaystogc.com: 0

Protected primary domain pathways2gc.com remains excluded from cold outbound.

## Last verified paid Google Workspace inventory

Independent active users previously verified:
- pathwaysgovcon.com: cora, evan, maya, silvia, victoria (5)
- pathwaysgsa.com: chris, evan, jake, kevin, ryan (5)
- pathwaysgov.com: aden, alexis, jeff (3)
- pathways2gc.co: none visible
- pathwaysfederal.com: none visible
- pathwaystogc.com: none visible

Therefore the current **zero-new-license-cost target is 13 independent outreach mailboxes** across the three domains where paid users were already verified.

This target supersedes the former no-fixed-sender-target reuse-first rule for FULL-GO acceptance. The former rule was useful during clean-soak stabilization, but it is no longer sufficient for revenue recovery because it allowed already-paid sender capacity to remain unused.

## Zero-cost FULL-GO target

The target pool is:

### pathwaysgovcon.com — target 5
- cora@pathwaysgovcon.com
- evan@pathwaysgovcon.com
- maya@pathwaysgovcon.com
- silvia@pathwaysgovcon.com
- victoria@pathwaysgovcon.com

### pathwaysgsa.com — target 5
- chris@pathwaysgsa.com
- evan@pathwaysgsa.com
- jake@pathwaysgsa.com
- kevin@pathwaysgsa.com
- ryan@pathwaysgsa.com

### pathwaysgov.com — target 3
- aden@pathwaysgov.com
- alexis@pathwaysgov.com
- jeff@pathwaysgov.com

Every target mailbox must be reconciled against live Workspace/Instantly state. No mailbox may count as FULL GO merely because the account exists.

## Acceptance requirements per mailbox

Each already-paid target mailbox must prove:
- independent licensed mailbox identity, not merely an alias
- connected/usable in Instantly
- SPF pass
- DKIM pass
- DMARC pass/alignment
- current inbox-placement evidence
- ACTIVE sender governance status
- warmup/health acceptable under current policy
- reply ingestion/routing works
- no unresolved provider errors
- no duplicate sender identity problem

WATCH, UNVERIFIED, disconnected, pending, inactive, or unhealthy mailboxes contribute zero governed capacity.

## Capacity target

At the current governed 25 campaign emails/day/account ceiling:
- 9 senders = 225/day
- 13 senders = 325/day

The 13-mailbox figure is a **zero-new-Workspace-license-cost capacity target**, not permission to purchase more licenses and not permission to raise per-mailbox send limits unsafely.

## Remaining approved domains

The other approved outreach domains remain part of the future capacity pool, but FULL GO does not authorize new recurring Workspace spend automatically:

### pathwaysfederal.com
- DNS previously GREEN for Google sender use.
- No paid Workspace users were visible in the last verified inventory.
- Do not create paid seats without separate CEO approval.

### pathways2gc.co
- Previously required MX/DKIM repair/verification before sender activation.
- No paid seats were visible.
- Do not create paid seats without separate CEO approval.

### pathwaystogc.com
- Previously used Namecheap forwarding rather than Google Workspace sender routing.
- No paid seats were visible.
- Do not migrate/purchase users without separate CEO approval.

These three domains must continue to be audited for low-cost or no-new-cost activation options, but aliases must never be represented as independent sending capacity.

## Alias rule

Aliases may be used for branding/receiving/normal business routing where appropriate, but:
- alias creation does not create another independent Google mailbox
- alias creation does not create another independent sender reputation
- aliases do not count toward governed sending capacity
- aliases do not satisfy the 13 independent paid-seat FULL-GO target

## FULL-GO rule

`ZERO_COST_SENDER_CAPACITY_FULL_GO = YES` only when all 13 already-paid independent outreach mailboxes are connected and independently health-proven ACTIVE using current authentication + inbox-placement evidence.

If fewer than 13 are actually usable, Miles must explicitly report:
- which paid seat is missing from Instantly
- which paid seat is connected but unhealthy
- exact blocker
- whether the blocker can be fixed at $0 added Workspace cost
- next safe action

No new paid Workspace seats may be created without explicit CEO approval.

## Safety

- No new paid Google Workspace users under this directive.
- No cold outbound from pathways2gc.com.
- No aliases counted as independent senders.
- No unsafe per-mailbox volume increase.
- Preserve SPF/DKIM/DMARC correctness and reply ingestion before capacity counts.
- Provider existence is not GREEN; live business-outcome evidence remains required.
