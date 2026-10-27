---
schema_version: 4
type: story
id: BRK-017
epic: BRK-E11
title: Persist versioned personas in SQLite and migrate the Persona Library
status: backlog
priority: normal
milestone: null
assignees: []
labels: ["deferred","sqlite","library"]
depends_on: []
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Persist versioned personas in SQLite and migrate the Persona Library

## Summary

Make SQLite authoritative for shared persona definitions, including stable identities and retained revisions. Adapt the existing Persona Library APIs and migrate existing Markdown definitions safely.

## Scheduling

Deferred by the user on 2026-10-24: keep this work in backlog while current Barracks testing continues. Begin implementation, migration or runner cutover only after testing finishes and the user explicitly resumes this epic.

## Acceptance Criteria

- [ ] Persona creation, edits, duplication, search and reference-aware deletion use SQLite through a defined repository interface; stable IDs and existing editor behavior are preserved.
- [ ] Each accepted edit creates an immutable persona revision. Optimistic concurrency rejects stale saves and preserves the user draft.
- [ ] An explicit, transactional and repeatable migration imports config/personas/*.md with their existing IDs, names and instruction text. Validate input before activation; failure leaves existing data usable and retry creates no duplicates.
- [ ] Fresh installations can seed the default personas. After migration, normal Library reads and writes use one authoritative SQLite source; preserved source files serve as migration backups or explicit seed/import material.
- [ ] Existing workflow references and already-pinned run instructions remain valid. Editing, archiving or deleting a Library definition preserves historical revisions needed by runs.
- [ ] Integration checks exercise CRUD, reference restrictions, stale edits, migration retry/failure and persistence across an owned test-runner restart.

## Dependencies

- Foundation slice for this epic.

## Scope boundaries

Keep PMT tickets/epics, source code, project configuration and large worker logs with their existing owners. Preserve SQLite execution records and per-run snapshots.

## References and evidence

- Follow-up to BRK-016, which implemented the current file-backed Library.
- `server/personas.ts`
- `server/library-files.ts`
- `server/store.ts`
- `web/persona-library.tsx`

## Questions

- Resolve detailed schema and bundle-format choices during implementation refinement; this ticket records the adopted storage direction.

## Plan

Deferred while current testing continues. Refine implementation after the user explicitly resumes BRK-E11; this required section records scheduling only.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |
