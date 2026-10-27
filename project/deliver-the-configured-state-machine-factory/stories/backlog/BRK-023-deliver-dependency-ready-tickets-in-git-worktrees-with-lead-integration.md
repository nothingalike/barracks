---
schema_version: 4
type: story
id: BRK-023
epic: BRK-E10
title: Deliver dependency-ready tickets in Git worktrees with Lead integration
status: backlog
priority: normal
milestone: null
assignees: []
labels: ["parallel","worktrees","delivery"]
depends_on: []
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Deliver dependency-ready tickets in Git worktrees with Lead integration

## Summary

Run independent tickets concurrently in managed Git worktrees, preserve configured role handoffs and recovery, integrate the combined result under Lead ownership, then pass final acceptance and publish uncommitted changes to the associated project folder.

## Acceptance Criteria

- Dispatch dependency-ready tickets in bounded batches, with a configurable limit of 1–8 and a default of two active ticket teams.
- Preserve the configured Lead, BA, Builder, Reviewer and recovery handoffs per ticket in real Git worktrees.
- Require independent review and Lead integration before an internal dependency is satisfied.
- Route integration conflicts and acceptance defects through configured repair and review stages.
- Resume persisted reservations/integration/repair safely and drain owned work on cancellation.
- Complete only after final acceptance, retrospective and safe uncommitted publication to the associated project folder.
- Preserve user edits, PMT metadata and existing pinned workflow runs; leave source commits and pushes to the user.

## References

- [Workflow behavior and qualification](../../../../docs/parallel-delivery.md)
- [Review](http://localhost:4321/f/barracks/stories/BRK-023/reviews/2026-10-24-1540-parallel-ticket-delivery)

## Questions

- No remaining questions.

## Plan

Implemented separate parent orchestration and internal ticket workflows. A shared private Git store owns ticket worktrees and integration anchors. The Lead reviews each combined batch, then final acceptance/retrospective precede guarded working-tree publication. Existing sequential definitions remain available for pinned-run compatibility. Library/SQLite storage migration remains deferred under BRK-E11.

## Verification evidence

- TypeScript check and production build passed. The final full suite passed 77 local tests; 22 isolated browser cases passed. Repair replay and publication-race regressions passed.
- Native-worker proof `d5c00265-45a3-41a4-93e2-33cd78654de7` passed with peak two concurrent assignments, three completed/integrated tickets, dependent continuation, final acceptance, retrospective and accepted uncommitted publication. Fixture source HEAD remained unborn.
- Evidence: `.state/parallel-real/a0b93ad8-bae8-4431-bf7f-aad6d37eae21/result.json` and run/assignment receipts under `.state/tasks`.
- Standards/Spec review findings were addressed: interrupted reservations, integration replay, accumulated checks, repair checkpoint atomicity and publication drift checks. Final Standards re-review found no remaining blocker.
- No user-source commits or pushes. Native qualification uses a disposable project; the accepted todo-app is preserved.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |
| 2026-10-24 | Codex | Implemented and qualified | backlog | backlog | Parallel teams, managed worktrees, Lead integration, repair/replay and accepted source publication; status retained for user review. |
