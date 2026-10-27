---
schema_version: 4
type: story
id: BRK-014
epic: BRK-E10
title: Run project-scoped discovery and epic delivery workflows
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

# Run project-scoped discovery and epic delivery workflows

## Summary

Replace execution-mode task creation with configured workflow runs, real persona discovery, editable PMT tickets and explicit epic delivery.

## Acceptance Criteria

- The header selects the project for tasks, tickets and creation. New task asks for a configured workflow, title and description; delivery additionally selects an epic.
- Product task creation and the direct-execution API accept real workers; simulation remains internal to tests.
- Product discovery / grilling assigns Product Owner, Architect and Project Manager personas. PO/Architect work through the brief and pause only for unresolved user decisions.
- Architect specification and PM planning produce canonical project-local PMT epic/tickets; discovery completes without starting coding work.
- Tickets are reviewable/editable in Barracks with revision checking and PMT validation. Saved edits precede a separately started epic delivery task.
- Epic delivery coordinates all dependency-ready tickets through Lead, mandatory BA, Builder and independent review. Accepted source carries forward and changed predecessors are refused.
- Persist workflow definition, discussion, questions, PMT references and child execution. Pause/cancel/restart preserve source and require reconciliation after uncertain interruption.
- Keep source integration separate. Preserve existing data and qualification evidence without exposing the previous execution-dropdown UI.

## References

- None.

## Questions

- No remaining questions.

## Plan

### Architecture

Add named workflow definitions and a Factory coordinator over the existing owned-process Runner/Store. Persist runs in SQLite, pin each selected definition, and keep personas separate. A read-only DiscoveryAgent executes configured persona turns; a constrained PMT host publishes and edits canonical project-local files. Delivery creates existing runner child executions from exact accepted predecessor snapshots. The new workspace UI uses project context, workflow tasks and a Tickets view.

### Models

Workflow definitions name a predefined discovery/delivery kind, participants, stage capacity and exchange budget. A Task is its run with goal, phase, turns, user questions, output epic/tickets and child executions. PMT owns epics/tickets, scope, dependencies and status; content revisions prevent stale edits. Child executions retain independent candidate/author/verification history and a trusted predecessor tree. Project, Persona, Workflow, Task, Epic and Ticket definitions are in GLOSSARY.md.

### Workflow

1. Select a project; create a real grilling task from the product brief.
2. Product Owner develops intent; Architect challenges it, asks only unresolved user decisions and produces a specification.
3. Project Manager proposes dependency-ordered tickets. Publish them through project-local PMT and stop for review.
4. User reviews/edits tickets, then explicitly starts delivery against the epic.
5. Lead routes every ticket through BA, Builder, independent verification/review and normal PMT status transitions. Carry the approved tree into the next ticket; publish no source commits/merges.
6. Qualify UI, canonical artifacts, scope boundaries, late results, restart holds and real discovery-to-two-ticket delivery in isolated fixtures.

## Decisions

2026-10-23, user: retire simulation from product execution; inherit project from the header; offer named predefined workflows. User accepted PO/Architect autonomy with pauses only for unresolved decisions. User accepted PMT files as the canonical ticket store with review/editing in Barracks before separate delivery. The previous single-pipeline UI is superseded by named runs; simulation remains a test fixture only.

## Evidence

Build/typecheck and twenty local tests pass. Twelve isolated browser cases cover inherited project context, workflow-only creation, mobile layout, decision answers, ticket edit/save-before-delivery, and project setup/settings. Factory tests exercise PMT publication/idempotency, revision conflicts, normal status transitions, parent-workspace refusal, mandatory BA, exact predecessor copying/refusal, cancellation and restart holds.

Real discovery 0d69e2dd-5c96-4b52-8f69-05b3c2492c0f completed five Product Owner/Architect/PM turns, produced an Architect specification and exactly two PMT tickets, and started no coding work. Headless Edge edited a ticket and explicitly started epic delivery 39636d37-c4b6-4bb2-8642-85242da3cd1e. The resumed run completed both tickets through BA/Builder/Reviewer, preserved the first behavior in the second candidate, passed an independent final test run and marked PMT tickets complete. Evidence: .state/factory-real/6475aec2-f0e7-4e2e-9791-2dd837dc9cc1/discovery.json and delivery-resumed.json.

Failures were retained and corrected rather than reported as passes: PMT initially resolved a parent workspace, creating a two-file test epic in Barracks. Its exact run marker/files were checked before removal and index rebuild; the host now refuses parent/outside-project paths and a regression proves no parent write. Real delivery then exposed backlog-to-in-progress sequencing and an inherited source snapshot being treated as a Git commit. Normal status transitions and snapshot metadata were fixed and tested. The verified empty, never-executed qualification manifest was repaired without changing source, then the same workflow was reconciled/resumed to completion. This is a recovered end-to-end qualification rather than a clean first attempt.

No Saltwake intake, source integration, remote publish or Barracks commit occurred. Native folder-dialog navigation retains its earlier manual-check limit. Existing direct-execution records remain in SQLite; superseded UI probes are archived. Story remains backlog/unassigned.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |
