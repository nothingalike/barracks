---
schema_version: 4
type: story
id: BRK-022
epic: BRK-E11
title: Qualify and document the SQLite Library migration before runner cutover
status: backlog
priority: normal
milestone: null
assignees: []
labels: ["deferred","sqlite","library"]
depends_on: ["BRK-017","BRK-020","BRK-021"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Qualify and document the SQLite Library migration before runner cutover

## Summary

Prove the full Library migration on a disposable copy before scheduling the real runner cutover after current testing and explicit user resumption.

## Scheduling

Deferred by the user on 2026-10-24: keep this work in backlog while current Barracks testing continues. Begin implementation, migration or runner cutover only after testing finishes and the user explicitly resumes this epic.

## Acceptance Criteria

- [ ] A disposable migration rehearsal uses representative current persona/workflow files and a copied database containing existing queued, waiting, completed and cancelled runs; preserve the source copy and record evidence.
- [ ] Checks prove migration interruption/retry safety, transaction rollback, duplicate prevention, preserved historical run snapshots and clean startup after the migrated runner restarts.
- [ ] Browser verification covers both Library editors, revision-conflict draft retention, reference-aware deletion, new-task selection and desktop/narrow layouts against the real SQLite-backed APIs.
- [ ] A bounded workflow proof shows a new run uses the migrated definitions and consistent revision provenance; a pre-migration run resumes from its original snapshot after Library edits.
- [ ] Document database/schema upgrades, initial seeding, backup and recovery steps, export format and the revised configuration ownership. Recovery restores a compatible database/application pair rather than enabling conflicting file and database writers.
- [ ] Before any real cutover, confirm current testing is finished, required assignments are drained and the user has explicitly resumed this work. Apply the established process ownership/restart preferences at that time.
- [ ] Record fixture results separately from live cutover evidence. Creating these tickets authorizes backlog planning only; keep their implementation deferred until resumed.

## Dependencies

- BRK-017
- BRK-020
- BRK-021

## Scope boundaries

Keep PMT tickets/epics, source code, project configuration and large worker logs with their existing owners. Preserve SQLite execution records and per-run snapshots.

## References and evidence

- Follow-up to BRK-016, which implemented the current file-backed Library.
- `docs/testing.md`
- `docs/workflow-configuration.md`
- `scripts/test-server.ts`
- `test/graph.test.ts`
- `e2e/personas.spec.ts`
- `e2e/workflow-library.spec.ts`

## Questions

- Resolve detailed schema and bundle-format choices during implementation refinement; this ticket records the adopted storage direction.

## Plan

Deferred while current testing continues. Refine implementation after the user explicitly resumes BRK-E11; this required section records scheduling only.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |
