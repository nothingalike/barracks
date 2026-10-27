---
schema_version: 4
type: story
id: BRK-006
epic: BRK-E02
title: Persist assignment and result obligations atomically
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-002"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-23
updated_at: 2026-10-23
---

# Persist assignment and result obligations atomically

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Persist assignment intent and terminal results with deduplicated outbox events before workers or dispatchers act.

## Acceptance Criteria

- [ ] Persist assignment intent and its launch obligation in one transaction before launch.
- [ ] Persist a validated terminal result and wake-up obligation in one transaction; clear stale launch obligations.
- [ ] Repeated identical submissions create no second obligation; conflicting identities/results are refused.
- [ ] Refuse overlapping active participant/ticket ownership and stale attempt numbers.
- [ ] Persist pause state; block new assignments while accepting active results.
- [ ] Recover committed results and unacknowledged obligations after abrupt process exit.
- [ ] Hold a single active local database owner and prove failed outbox writes roll back associated state.

## References

- [Ledger interface and limits](../../../../archive/2026-10-22/prototype/docs/implementation/execution-ledger.md).
- [Approved delivery order](../../../../archive/2026-10-22/prototype/docs/implementation/delivery-plan.md).
- Source: src/ledger/execution-ledger.ts; tests: test/ledger.test.ts.

## Questions

- Production leases, coordinator epochs, dispatch claims and external-effect reconciliation require later slices.
- Node 24.5's SQLite module is experimental; requalify on runtime upgrades.

## Plan

### Architecture

Use a single-owner file-backed SQLite ledger with transactional outbox obligations. Keep Mastra workflow storage separate under the intended runtime owner. Launch and external effects stay behind future broker/dispatcher gates.

### Models

Assignments carry job/project/ticket/participant/attempt/baseSha. Terminal results use the existing strict workerResult contract. Obligations use stable launch and result operation keys. Schema version 1 stores jobs, outbox and per-project pause controls.

### Workflow

1. Atomically record assignment intent and launch obligation.
2. Validate exact identity and atomically record result, retire stale launch obligation and append wake-up obligation.
3. Expose pending obligations for future at-least-once consumers; acknowledge by stable identity.
4. Verify real SQLite rollback, duplicates, capacity, pause, abrupt exit and exclusive ownership.

## Evidence

2026-10-22 local: TypeScript and all 19 focused tests PASS, including seven real SQLite ledger tests and Windows cancellation/host-loss fixtures. Injected outbox errors roll back assignment/result state. An abruptly exited child leaves one committed result obligation, with no launch obligation to replay. Live dispatch remains disabled. Status stays backlog/unassigned.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

