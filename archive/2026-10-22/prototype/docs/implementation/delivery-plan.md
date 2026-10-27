# Barracks delivery plan

Current direction, October 22, 2026: the user adopted the official Mastra Factory starter with team persona/instruction configuration. BRK-008 owns that setup. The custom-runtime packages below are historical planning references; they do not require duplicating Factory's built-in ledger, broker, dispatcher or UI. Retain useful qualification evidence and revisit gaps only when they arise in the configured starter.

Canonical PMT workspace: `.workspace/pm-toolbox.yml` in this repository, key `BRK`. GitHub integration is disabled. Headquarters holds design decisions and private execution evidence; PMT holds scope and dependencies.

The user approved the operating model and authorized continuation from the takeover handoff on October 22, 2026. Package scope below follows Headquarters `barracks/general/design/2026-10-22/delivery-order.md`. Epics preserve that scope; delivery stories are refined in small slices as predecessor interfaces become known.

| Package | Epic | Depends on | Delivery boundary |
|---|---|---|---|
| P01 | BRK-E01 | None | CLI and Windows qualification, BRK-001 through BRK-005 |
| P02 | BRK-E02 | P01 protocol evidence | Contracts and execution ledger; first slice BRK-006 |
| P03 | BRK-E03 | P01, P02 | CLI broker and reconciliation |
| P04 | BRK-E04 | P02, P03 | Mastra workflows and dispatcher |
| P05 | BRK-E05 | P02, P03 | Review and Git integration gates |
| P06 | BRK-E06 | P02, P05 | PMT and Headquarters adapters |
| P07 | BRK-E07 | P04 | Dashboard, chat controls and local notifications |
| P08 | BRK-E08 | P03 through P07 | Windows launcher and full-team recovery rehearsal |
| P09 | BRK-E09 | P08 | Exclusive whole-team transfer |

BRK-002 depends on BRK-001. BRK-003 and BRK-004 depend on BRK-002. BRK-005 depends on BRK-001. These are qualification prerequisites, not claims that earlier experiments pass.

The fixed roster is one Lead, one BA and two Builders. Peer review uses an existing Builder slot. A story being created or having passing evidence does not change its PMT status automatically. No participants are assigned by this plan.

Saltwake remains under its existing coordinator. Live dispatch stays disabled while authentication, enforced access boundaries, process ownership and recovery remain unqualified. Every later package requires small stories and independent review before implementation assignment; the epics are not oversized Builder assignments.
