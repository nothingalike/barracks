---
schema_version: 4
type: story
id: BRK-012
epic: BRK-E10
title: Scope the workspace with a persistent project switcher
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

# Scope the workspace with a persistent project switcher

## Summary

Add a searchable header project selector with an all-projects overview, scoped task/activity views, persistent navigation and inherited new-task context.

## Acceptance Criteria

- Search configured projects from the header; retain an All projects overview.
- Scope the task list, selected task and running/blocked/completed counts to the selected project.
- Persist selection in the URL and browser storage; support browser Back and safely fall back when a project is removed.
- Inherit the selected project when creating real or simulated tasks and submit its project ID.
- Support keyboard selection, empty search results and narrow mobile screens.
- Keep dispatch pause and capacity global and label their scope. Project configuration remains file based.

## References

- None.

## Questions

- No remaining questions.

## Plan

### Architecture

Add a searchable React project switcher to the existing header using configured projects from the snapshot. Filter task presentation in the dashboard; retain global runner controls and capacity. Backend dispatch and project configuration remain unchanged.

### Models

Store a selected project ID or the All projects sentinel in component state, URL query and local storage. Keep the new-task draft project separate so its native select can override the inherited context. Validate persisted selections against the current configured list.

### Workflow

1. Select or search a project; clear the previous detail and select a visible task.
2. Reflect its tasks and counters, preserving a shareable URL and browser history.
3. Inherit its project into either task execution mode; keep a submitted task visible after creation.
4. Verify two-project behavior with browser response fixtures and actual project-ID submission with a simulated task.

## Evidence

2026-10-23: typecheck and production build pass. Eight isolated headless Edge browser tests pass, including four project-selector cases: scoped tasks/counters, reload and Back, search/keyboard, saved and removed selection, mobile layout, inherited form context and actual simulated POST with projectId=slug followed by reload. Desktop and mobile screenshots inspected. The configured workspace currently contains one disposable fixture; the second project in browser tests is a response fixture. Real Codex/recovery qualifications from BRK-011 were not repeated for this UI-only slice. Source remains uncommitted and story status remains backlog/unassigned.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |
