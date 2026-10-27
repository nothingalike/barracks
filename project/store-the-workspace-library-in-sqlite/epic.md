---
schema_version: 1
type: epic
id: "BRK-E11"
title: "Store the workspace Library in SQLite"
slug: "store-the-workspace-library-in-sqlite"
status: planned
owners: []
labels: []
created_at: "2026-10-24"
updated_at: "2026-10-24"
---

# Store the workspace Library in SQLite

## Summary

Move shared persona and workflow definitions to versioned SQLite storage while preserving existing run snapshots and portable import/export. Deferred by the user on 2026-10-24: keep this work in backlog while current Barracks testing continues. Begin implementation, migration or runner cutover only after testing finishes and the user explicitly resumes this epic.

## Goals

- Manage shared personas and workflows through one authoritative, versioned SQLite Library.
- Preserve pinned execution snapshots and provide portable definition import/export.

## Non-Goals

- Keep this epic deferred while current testing continues.
- Keep PMT tickets/epics, source workspaces, large logs and project configuration with their current owners.
- Leave current runtime data and running assignments untouched during backlog planning.

## Success Measures

- Both Library editors and run creation use migrated SQLite definitions with revision provenance.
- Migration, recovery, concurrency and import/export checks pass before an explicitly scheduled cutover.

## References

- None.

## Questions

- No remaining questions.

## Work Items

[View this epic's generated work-item index](epic-index.md).

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | planned | Initial epic |
