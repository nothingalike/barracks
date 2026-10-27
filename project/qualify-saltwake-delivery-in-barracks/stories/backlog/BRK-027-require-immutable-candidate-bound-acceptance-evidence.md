---
schema_version: 4
type: story
id: BRK-027
epic: BRK-E12
title: Require immutable candidate-bound acceptance evidence
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-026"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Require immutable candidate-bound acceptance evidence

## Summary

Validate command/artifact/build/helper/platform evidence, preserve raw failures separately from criterion disposition, and distinguish child review, integration and parent acceptance.

## Acceptance Criteria

- Bind runner receipts and immutable artifact hashes to exact candidate/build/helper/platform provenance.
- Require expected evidence for each applicable acceptance criterion; model prose cannot establish missing observations.
- Preserve failed raw measurements, bounded adjudications, explicit waivers and unverified checks separately.
- Keep ticket review, successful integration, parent acceptance and publication completion distinct.

## References

- [Target workflow and qualification plan](../../../../docs/saltwake-delivery.md)
- [Operational readiness assessment](http://localhost:4321/f/barracks/general/reports/2026-10-24-1845-saltwake-readiness)

## Questions

- No remaining questions.

## Plan

Follow package 4 in [Saltwake delivery readiness](../../../../docs/saltwake-delivery.md). Review against frozen pre-change source `.state/saltwake-before`; no committed HEAD exists.

Implemented and qualified within the boundaries below.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |

## Current implementation evidence

Implemented explicit per-criterion evidence planning before Builder pickup, immutable candidate-bound command/artifact receipts, typed platform observations, operator waivers/adjudication and validation again before publication. Failed Cargo101 receipts retain their real leaf code; legacy invented waivers, stale/unknown IDs, altered artifacts, missing platform/build identity and cross-criterion adjudication are rejected. Explicit completion keeps canonical tickets open until accepted source delivery. Browser evidence/waiver UI and regression checks pass.

See [implementation and proof boundaries](../../../../docs/saltwake-delivery.md). Story status remains unchanged for user review. BRK-E11 SQLite Library migration remains deferred.

Review: http://localhost:4321/f/barracks/general/reviews/2026-10-24-2238-qualified-saltwake-delivery
