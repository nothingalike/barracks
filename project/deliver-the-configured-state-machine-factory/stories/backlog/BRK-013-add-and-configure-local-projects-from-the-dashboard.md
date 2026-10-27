---
schema_version: 4
type: story
id: BRK-013
epic: BRK-E10
title: Add and configure local projects from the dashboard
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

# Add and configure local projects from the dashboard

## Summary

Link committed local repositories through Add Project and edit source, verification and project instructions through Project Settings.

## Acceptance Criteria

- Add Project accepts a local folder through the normal Windows folder picker or path entry, then offers missing Git setup during intake.
- Ask separately before initializing Git and creating its first commit; let the user select files and author identity, or decline each action. Allow an empty first commit for an empty folder.
- Register an empty project using instructions/review criteria alone. Existing source, protected files and configured build/test commands are optional.
- With no configured commands, require the first Builder to establish a nonempty validated task verification plan; run it independently and reuse the fixed plan for review/fixes.
- Detect the project name and suggest existing npm build/test scripts for confirmation without executing them.
- Project Settings edits name, folder, ref, verification, project instructions, review criteria and protected files; project ID remains stable.
- Persist settings without restarting the runner; keep source files and Git history unchanged.
- Reject duplicate folders/IDs, missing committed refs and invalid protected paths. Hold settings changes while real tasks remain unfinished.
- Supply saved project instructions to worker assignments. Preserve workspace personas and workflow configuration.

## References

- None.

## Questions

- No remaining questions.

## Plan

### Architecture

Add project-management endpoints behind the existing local-origin checks and a setup/settings page. A small Windows helper opens the standard Explorer folder dialog in folder-selection mode. Reuse the existing project schema and atomically replace its JSON configuration. Runtime reads make saved changes available immediately. Block edits during unfinished real tasks so their source and review rules stay stable.

### Models

Extend project configuration with optional project instructions, default empty for existing projects. Keep stable IDs and explicit command executable/argument/access records. Separate form drafts from saved configuration and suggest npm scripts using package metadata only. Test configuration can be isolated with BARRACKS_PROJECTS_PATH.

### Workflow

1. Select a folder in the Windows dialog or enter its path. Inspect Git readiness; offer initialization and initial-commit actions separately and only perform each after explicit confirmation. Existing committed repositories proceed directly.
2. Confirm name, suggested commands and project rules; register and select the project.
3. Edit settings from the selected project's menu and validate the whole draft before saving.
4. Qualify registration, persistence, invalid/busy edits and source preservation through an isolated real API/browser harness; run existing regressions.

## Evidence

2026-10-23: initial project settings qualification passed build/typecheck, 15 local tests and nine browser tests. The user then requested the normal Windows folder dialog instead of the in-page directory browser. The directory-list API/UI is replaced by Choose folder in setup and settings; native selection fills the path and setup opens the project details. Cancellation preserves the draft. A single outstanding dialog is allowed, with a ten-minute timeout; path entry remains available after a helper failure.

Updated qualification covers ten isolated browser cases with simulated native picker responses and real project inspection/save endpoints, plus a native helper compile/COM-configuration test in the 16-test local suite. Native dialog interaction itself requires a manual Windows check and is not represented as an automated pass. Test sources/configuration/database remain isolated under .state/project-ui; source bytes/HEAD and runner-restart persistence are checked. Final results/screenshots are in the BRK-013 HQ review. Status remains backlog/unassigned; no commit/push or Saltwake intake.

The user clarified Git belongs in ingestion: missing setup should prompt for consent rather than reject the folder. Intake now returns needs-git, needs-commit or ready. Each mutation requires confirmed=true, rechecks current Git state and stays scoped to the selected folder. Initial commits include explicitly selected files plus already-staged files the user must also confirm, honor Git ignores, use a per-command author identity and suppress hook/signing side effects. Existing staged files are preserved on refusal; a failed commit reports that selected files may remain staged. Twelve isolated browser cases pass, including refusal without mutation, initialization, first-commit selection, ignored-file exclusion, empty commit and registration. The original committed fixture's bytes/HEAD and restart persistence still pass. Git initialization/commits were exercised only in disposable fixtures; the Barracks repository remains uncommitted.

The empty-project form correction removes mandatory verification commands and makes protected-file fields explicitly optional. A new task with no configured commands requests verificationCommands from the first Builder, validates the native executable/argument/access records and stores them outside the source copy. Independent Builder verification and the read-only Reviewer rerun the same fixed plan; empty/malformed plans and replacement are refused. Build/typecheck, 17 local tests and twelve browser cases pass. Real empty-project task f2726981-9287-4c6e-bf84-bc724b5d6688 completed through Lead/Builder/Reviewer; both independent verification receipts exited zero/drained, four greeting tests passed, and the original source remained empty except .git. Evidence: .state/new-project-real/3a5f674b-7a2c-435a-aef5-ab6f4bd692a4/result.json and the task's verification.json. The normal app is updated; no user project or Barracks commit was made.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |
