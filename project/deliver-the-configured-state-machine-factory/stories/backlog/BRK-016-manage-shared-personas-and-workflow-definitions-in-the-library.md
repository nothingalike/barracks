---
schema_version: 4
type: story
id: BRK-016
epic: BRK-E10
title: Manage shared personas and workflow definitions in the Library
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

# Manage shared personas and workflow definitions in the Library

## Summary

Build Personas first, then a validated workflow state editor in a workspace Library, preserving pinned task definitions and file-based configuration.

## Acceptance Criteria

- [x] A workspace Library is available independently of the selected project, with Personas implemented before Workflows.
- [x] Personas support creation, name/instruction edits, duplication, search and deletion of unused definitions; workflow/state references explain deletion restrictions.
- [x] Workflow editing exposes initial state, states, personas, executor roles, instructions, inputs, parallelism, budgets and event handoffs with target/output/clear/guard/resume settings and a graph preview.
- [x] Creation, edits and deletion preserve stable IDs, reject stale revisions, validate graph/persona references before writes, and leave invalid saves unchanged.
- [x] Saved workflows appear in new-task selection. New tasks pin the latest graph and persona content; existing tasks can resume after their definitions are edited or deleted.
- [x] Unsaved changes survive refused navigation or stale-save errors; desktop and narrow-screen browser checks pass.
- [x] Configuration remains in persona Markdown and workflow JSON; edits persist across runner restart. SQLite remains task coordination storage.

## References

- [Implementation review and screenshots](http://localhost:4321/f/barracks/stories/BRK-016/reviews/2026-10-23-1716-persona-workflow-library)
- [Workflow configuration](../../../../docs/workflow-configuration.md)
- [Persona editor](../../../../web/persona-library.tsx), [workflow editor](../../../../web/workflow-library.tsx)

## Questions

- No remaining questions.

## Plan

1. Add Persona file management and reference-aware APIs, then the workspace Library UI and isolated browser checks.
2. Add Workflow definition management using the existing runtime schema and canonical JSON file.
3. Expose state assignments, event handoffs and graph preview; preserve unsaved drafts and optimistic conflicts.
4. Prove CRUD, validation, new-task selection, pinned execution and restart persistence in isolated fixtures, then apply the build to the idle agent-owned local runner.

## Decisions and evidence

- The user accepted Personas first, then Workflows. Both are workspace definitions shared across projects.
- File-based configuration remains canonical; atomic replacements and SHA-256 revisions prevent partial saves and reject stale edits. Workflow revisions cover the entire shared file.
- Referenced Personas require reassignment before deletion. Workflow deletion affects future choices; active tasks retain pinned definitions and instructions.
- The editor configures the runtime's existing executor capabilities. Native source, process and independent-review enforcement remain in the executors. A drag-and-drop designer is deferred.
- `npm run build` and 26 local tests passed. The four graph tests were rerun after extending the snapshot case to use the Library APIs: a future task sees updated graph/persona content while an existing task resumes after definition deletion.
- `npm run test:library`: 15/15 headless Edge cases passed, including both editors, invalid graph nonmutation, reference deletion protection, conflict/draft handling, new-task options, project navigation, human answers, narrow layout and persistence across owned runner restart.
- Evidence: `.state/library-ui/84e2fc1a-c40b-4d17-a575-78ab64af5bd7/`. Screenshots inspected at desktop and 390px widths.
- Earlier browser runs exposed test locator assumptions for implicit labels; textareas now also have explicit accessible names. The legacy workflow fixture also caught absent persona snapshots; display names fall back safely to the persona ID. Failed attempts remain under ignored evidence folders.
- No fresh paid model execution was needed for the management editors; existing native-worker qualification belongs to BRK-015. Configuration-driven execution and snapshot preservation use bounded local worker doubles in the graph tests. Source integration remains separately authorized.
- Applied to the verified idle agent-owned runner at `http://127.0.0.1:4111`. All work remains uncommitted; story status remains backlog.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |
| 2026-10-23 | Codex | Implemented and qualified | backlog | backlog | Shared Persona and Workflow Library, canonical file persistence, graph validation, pinned-task proof and isolated browser checks. |
