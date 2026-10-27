---
schema_version: 4
type: story
id: BRK-026
epic: BRK-E12
title: Coordinate project ownership and wake scoped Lead decisions
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-024","BRK-025"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Coordinate project ownership and wake scoped Lead decisions

## Summary

Persist scoped participant/file/resource ownership and interface decision requests, wake the one project Lead, preserve independent work and exact-candidate independent Spec/Standards review.

## Acceptance Criteria

- Bind responsibility stages to a configured project roster and one Lead authority; prevent concurrent reuse of one participant or author self-review.
- Reserve overlapping source paths and named host/project resources until owned work drains.
- Route bounded interface requests automatically through project Lead resolution and resume implementation without a user check-in.
- Require separate Spec and Standards verdicts on the exact candidate; invalidate stale verdicts after a new build.

## References

- [Target workflow and qualification plan](../../../../docs/saltwake-delivery.md)
- [Operational readiness assessment](http://localhost:4321/f/barracks/general/reports/2026-10-24-1845-saltwake-readiness)

## Questions

- No remaining questions.

## Plan

Follow package 3 in [Saltwake delivery readiness](../../../../docs/saltwake-delivery.md). Review against frozen pre-change source `.state/saltwake-before`; no committed HEAD exists.

Implemented durable participant/source/resource leases, typed interface requests and bounded Lead delegation, review facets and exact-candidate dual verdicts. Controlled orchestration test/coordination.test.ts passed with no user turn. New qualified graphs remain test fixtures pending full release qualification. Native model whole-team proof remains BRK029.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |

## Current implementation evidence

Implemented durable participant/path/resource leases, independently allocated Spec/Standards reviewers, same-candidate rejection budgets and Lead-owned bounded interface grants. Source+tracker authority locks fence independent coordinators. Controlled interface/rejection/conflict/restart scenarios pass. Actual four-role Codex Rust delivery passed with two concurrent Builders and exact-candidate independent reviews, Lead integration, acceptance and publication.

See [implementation and proof boundaries](../../../../docs/saltwake-delivery.md). Story status remains unchanged for user review. BRK-E11 SQLite Library migration remains deferred.

Review: http://localhost:4321/f/barracks/general/reviews/2026-10-24-2238-qualified-saltwake-delivery


## Epic planning follow-up, 2026-10-26

Initial file ownership may be planned by the configured Lead during triage or technical recovery. The Store holds an ungranted Builder before assignment; protected paths, existing ownership and later shared-interface grants retain their guards. Missing ownership is a routine engineering handoff. Epic-only proof and tests: http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery
