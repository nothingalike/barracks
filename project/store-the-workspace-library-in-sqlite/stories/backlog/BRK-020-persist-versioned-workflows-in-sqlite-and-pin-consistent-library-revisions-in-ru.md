---
schema_version: 4
type: story
id: BRK-020
epic: BRK-E11
title: Persist versioned workflows in SQLite and pin consistent Library revisions in runs
status: backlog
priority: normal
milestone: null
assignees: []
labels: ["deferred","sqlite","library"]
depends_on: ["BRK-017"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Persist versioned workflows in SQLite and pin consistent Library revisions in runs

## Summary

Move the Workflow Library to SQLite and start runs from one consistent saved workflow/persona snapshot, preserving every existing execution record.

## Scheduling

Deferred by the user on 2026-10-24: keep this work in backlog while current Barracks testing continues. Begin implementation, migration or runner cutover only after testing finishes and the user explicitly resumes this epic.

## Acceptance Criteria

- [ ] Workflow creation, editing, duplication, deletion and new-task selection use stable SQLite identities and immutable revisions; existing graph/executor validation remains enforced.
- [ ] Workflow graph validation and persona-reference validation complete before a transactional save. Stale revisions and invalid references leave the saved Library unchanged.
- [ ] An explicit, repeatable migration imports config/workflows.json with stable IDs and equivalent graph content; all persona references resolve before activation.
- [ ] Run creation reads a consistent workflow revision and participating persona revisions and saves their snapshot and revision provenance atomically. Concurrent Library edits cannot produce a mixed snapshot.
- [ ] Existing workflow_runs JSON records remain executable from their original pinned definitions and instructions. Migration preserves IDs, handoffs, artifacts and recovery state without rewriting past behavior.
- [ ] Library edits or deletion affect future selections while active and historical runs retain their pinned versions. Fresh installations seed usable default workflows.
- [ ] Integration checks cover invalid graph nonmutation, revision conflicts, concurrent run creation, edited/deleted definitions, existing-run compatibility and restart persistence.

## Dependencies

- BRK-017

## Scope boundaries

Keep PMT tickets/epics, source code, project configuration and large worker logs with their existing owners. Preserve SQLite execution records and per-run snapshots.

## References and evidence

- Follow-up to BRK-016, which implemented the current file-backed Library.
- `server/workflow-definitions.ts`
- `server/workflow-library.ts`
- `server/factory.ts`
- `shared/state-machine.ts`
- `server/store.ts`

## Questions

- Resolve detailed schema and bundle-format choices during implementation refinement; this ticket records the adopted storage direction.

## Plan

Deferred while current testing continues. Refine implementation after the user explicitly resumes BRK-E11; this required section records scheduling only.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |
