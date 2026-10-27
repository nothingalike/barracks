---
schema_version: 4
type: story
id: BRK-009
epic: BRK-E10
title: Run a persisted task through the configured workflow
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: []
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-23
updated_at: 2026-10-23
---

# Run a persisted task through the configured workflow

## Summary

Define the state contract and scaffold the local dashboard and runner with simulated workers before connecting a real coding tool.

## Acceptance Criteria

- [x] Document states, authorized roles, accepted results, review/fix routing and terminal semantics.
- [x] Scaffold Vite/React, a separate Node/TypeScript runner and local SQLite.
- [x] Configure independent state concurrency with default one; keep Builder and Reviewer roles separate.
- [x] Persist assignment/state/history atomically; prevent duplicate active assignments and stale candidate review.
- [x] Demonstrate automatic simulated triage/refinement/build/review/fix/completion.
- [x] Expose task progress/history, new simulated task, pause, cancellation and blocker resolution in the dashboard.
- [x] Hold interrupted attempts for reconciliation; preserve pause and prevent a second database owner.
- [ ] Complete browser-driven visual/interaction verification when a browser automation surface is available.

## References

- [Workflow contract](../../../../docs/workflow.md).
- [Adopted policy and scope](../../../../docs/current-direction.md).
- [Run commands](../../../../README.md).
- Source: shared/workflow.ts; server/store.ts; server/runner.ts; server/index.ts; web/main.tsx.

## Questions

- Real native Codex execution, personas/tool permissions and safe process/Git reconciliation are subsequent integration work.
- PMT/HQ adapters and integrating reviewed changes are outside this simulation slice.

## Plan

### Architecture

Persist task states and assignment attempts in SQLite, using a separate local runner. React displays the runner snapshot and per-task history. Keep the worker adapter independent of the workflow contract; simulation is explicit throughout the UI.

### Models

Tasks store state, scope readiness, verified candidate revision, implementation author, review rounds and blocker/resume state. Assignments bind task, execution stage, role, worker identity, candidate revision and lifecycle status. Configuration sets per-state parallelism (default one) and optional review-cycle budget. Pause is persisted independently of tasks.

### Workflow

1. Lead triages sufficiently specified work directly to ready, otherwise BA refines it.
2. Claim implementation capacity transactionally; Builder returns a verified candidate revision.
3. Dedicated Reviewer accepts that exact revision or requests changes for another Builder iteration.
4. Complete only on matching independent approval. Keep integration separately authorized.
5. Persist blockers, pause and cancellation; recover interrupted assignments into reconciliation holds.
6. Verify SQLite invariants and automatic simulated execution before real CLI integration.

## Evidence

2026-10-22 local: seven tests PASS against real SQLite and the asynchronous runner; typecheck and Vite production build PASS. Public HTTP exercise completes a task through BA, two builds and two reviews; invalid input and foreign-origin requests are rejected, and pause/cancel pass. Browser automation exposes no available browsers (IAB unavailable, inventory empty), so visual/interaction verification remains unperformed. No model, coding CLI, repository or remote Git operation ran. Existing story status remains backlog/unassigned; no commit or push.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

