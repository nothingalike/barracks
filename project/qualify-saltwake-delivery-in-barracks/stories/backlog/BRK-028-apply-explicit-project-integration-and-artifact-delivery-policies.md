---
schema_version: 4
type: story
id: BRK-028
epic: BRK-E12
title: Apply explicit project integration and artifact delivery policies
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-027"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Apply explicit project integration and artifact delivery policies

## Summary

Preserve uncommitted copy policy and add controlled reviewed handoff/Lead integration with immutable manifests, reconciled external effects and a separate publication gate.

## Acceptance Criteria

- Keep working-tree publication as an explicit project policy and support reviewed handoff/Lead integration for Saltwake.
- Journal and reconcile tracker/Git/artifact effects before retry, including a crash after effect but before workflow checkpoint.
- Stage risky PMT mutations on isolated copies, guard canonical preimages and publish only declared changes.
- Preserve source/package freshness, protected refs, user edits and a separate externally authorized preview/publication gate.

## References

- [Target workflow and qualification plan](../../../../docs/saltwake-delivery.md)
- [Operational readiness assessment](http://localhost:4321/f/barracks/general/reports/2026-10-24-1845-saltwake-readiness)

## Questions

- No remaining questions.

## Plan

Follow package 5 in [Saltwake delivery readiness](../../../../docs/saltwake-delivery.md). Review against frozen pre-change source `.state/saltwake-before`; no committed HEAD exists.

Implemented and qualified within the boundaries below.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |

## Current implementation evidence

Implemented backward-compatible working-tree publication and explicit reviewed-branch handoff with durable manifest/ref-CAS replay. Reviewed branches preserve tracked PMT metadata and dirty managed-source deletions; excluded changes are rejected before ref effects. Actual Lead integration and Source bytes are verified before canonical completion. PMT operations stage on disposable Git copies and commit preimage-checked metadata deltas behind a durable SQLite journal; crash replay, external edits, foreign temps, dangling/mixed-case paths and managed GitHub mutation guards pass. Preview deployment stays an explicit operator handoff; no remote publication adapter was added.

See [implementation and proof boundaries](../../../../docs/saltwake-delivery.md). Story status remains unchanged for user review. BRK-E11 SQLite Library migration remains deferred.

Review: http://localhost:4321/f/barracks/general/reviews/2026-10-24-2238-qualified-saltwake-delivery
