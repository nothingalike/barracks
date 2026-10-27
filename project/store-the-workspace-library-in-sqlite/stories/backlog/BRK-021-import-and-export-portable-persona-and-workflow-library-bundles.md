---
schema_version: 4
type: story
id: BRK-021
epic: BRK-E11
title: Import and export portable Persona and Workflow Library bundles
status: backlog
priority: normal
milestone: null
assignees: []
labels: ["deferred","sqlite","library"]
depends_on: ["BRK-017","BRK-020"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Import and export portable Persona and Workflow Library bundles

## Summary

Provide explicit portable import/export for the SQLite-backed Library so definitions remain reviewable and transferable without copying the runtime database.

## Scheduling

Deferred by the user on 2026-10-24: keep this work in backlog while current Barracks testing continues. Begin implementation, migration or runner cutover only after testing finishes and the user explicitly resumes this epic.

## Acceptance Criteria

- [ ] An export bundle has a documented format version and includes selected workflow definitions plus the persona content needed to use them, with stable IDs and revision/provenance metadata.
- [ ] Import offers a reviewable preview showing additions, ID conflicts, invalid graphs and missing references before any write. Collision handling requires an explicit choice and preserves stable identity rules.
- [ ] Validated import applies as one transaction; a malformed definition or failed write leaves the saved Library unchanged. Reimport behavior is documented and tested.
- [ ] Export followed by import into a clean disposable installation preserves instruction text, graph semantics and reference relationships.
- [ ] Importing updated definitions affects future runs while existing run snapshots remain unchanged.
- [ ] Bundles contain definition data only. PMT tickets, project configuration, credentials, execution records, source workspaces and worker logs remain with their current owners.
- [ ] The Library exposes discoverable import/export controls with recoverable errors, and documents how the original Markdown/JSON configuration can be imported.

## Dependencies

- BRK-017
- BRK-020

## Scope boundaries

Keep PMT tickets/epics, source code, project configuration and large worker logs with their existing owners. Preserve SQLite execution records and per-run snapshots.

## References and evidence

- Follow-up to BRK-016, which implemented the current file-backed Library.
- `web/library.tsx`
- `web/persona-library.tsx`
- `web/workflow-library.tsx`
- `shared/library.ts`
- `server/workflow-library.ts`

## Questions

- Resolve detailed schema and bundle-format choices during implementation refinement; this ticket records the adopted storage direction.

## Plan

Deferred while current testing continues. Refine implementation after the user explicitly resumes BRK-E11; this required section records scheduling only.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |
