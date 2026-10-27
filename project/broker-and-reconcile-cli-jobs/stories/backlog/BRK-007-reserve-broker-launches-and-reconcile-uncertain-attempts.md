---
schema_version: 4
type: story
id: BRK-007
epic: BRK-E03
title: Reserve broker launches and reconcile uncertain attempts
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-004","BRK-006"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-23
updated_at: 2026-10-23
---

# Reserve broker launches and reconcile uncertain attempts

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Persist one launch reservation per assignment, retain process identity and fail closed across uncertain launch/restart boundaries.

## Acceptance Criteria

- [ ] Persist immutable launch reservation before any fixture process starts.
- [ ] Concurrent/replayed ensures create at most one launch attempt for the assignment.
- [ ] Persist and inspect exact PID/start identity; refuse automatic replacement on uncertainty.
- [ ] Recover reservations and receipts across reopen, preserving early terminal results and pause controls.
- [ ] Migrate schema 1 without losing jobs, outbox or pause state.

## References

- [Broker behavior, runtime evidence and Factory fit question](../../../../archive/2026-10-22/prototype/docs/implementation/broker-reservations.md).
- Source: src/broker/launch-broker.ts, src/broker/contracts.ts, src/ledger/execution-ledger.ts.

## Questions

- Assess the official Mastra Factory starter before expanding custom orchestration. External CLI-worker adaptation, fixed role capacity and PMT/HQ authority are unverified fit questions, not adopted changes.
- Production worker isolation and persistent host/coordinator survival remain qualification gates. This slice is fixture-only.

## Plan

### Architecture

Store launch reservations and process receipts in the single-owner execution ledger. Use a narrow fixture-runtime port for launch/inspection; uncertain external effects require reconciliation.

### Models

Schema 2 launch records carry job ID, immutable fixture fingerprint, state, PID/start identity and reconciliation reason.

### Workflow

1. Reserve launch transactionally before invoking a fixture runtime.
2. Persist its process receipt and retire the launch obligation, preserving any early terminal result.
3. On replay, inspect the recorded identity or report reconciliation-required; launch no replacement.
4. Test real processes, crash boundaries, duplicates, pause, identity mismatch and schema migration.

## Evidence

2026-10-22 local: TypeScript and all 26 tests PASS; final focused broker rerun 7/7 PASS. Native Codex 0.163.0 passes five disposable filesystem checks; 0.162.1 sandbox setup fails on an in-use node_repl.exe ACL update. Details and limits are in broker-reservations.md. No live provider adapter, persistent daemon or dispatcher is activated. Status remains backlog/unassigned.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

