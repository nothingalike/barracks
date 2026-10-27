---
schema_version: 4
type: story
id: BRK-011
epic: BRK-E10
title: Run and recover real coding tasks from the dashboard
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

# Run and recover real coding tasks from the dashboard

## Summary

Connect configured local projects and real Codex workers to the dashboard, enforce owned-process cancellation/reconciliation and qualify real failure paths before Saltwake intake.

## Acceptance Criteria

- [x] Start real Codex tasks from the dashboard with configured local project selection and separate Builder/Reviewer responsibilities.
- [x] Run Lead triage, optional BA refinement, implementation, independent review and fixes through persisted role-constrained transitions.
- [x] Configure per-state parallelism (default one), verification commands, role instructions and bounded Lead technical resolutions.
- [x] Give each task an independent source copy and preserve the configured source repository and refs.
- [x] Persist and display source candidates, task history, plans, blockers, worker sessions and logs.
- [x] Keep capacity reserved until cancellation cleanup is confirmed; prove real writing-worker cancellation stops later writes.
- [x] Prove coordinator loss terminates its real writer, restart holds the old attempt without duplicate launch, and explicit reconciliation resumes preserved work.
- [x] Reject an actual stale review without advancing review rounds; finish only after new verification and independent approval.
- [x] Provide repeatable isolated real-browser and recovery commands; qualify the final app in headless Edge, including mobile layout.
- [x] Archive the superseded standalone adapter, document commands/limits, and keep runtime/model evidence ignored.

## References

- [Real testing guide and commands](../../../../docs/testing.md).
- [Workflow contract](../../../../docs/workflow.md).
- [Current direction](../../../../docs/current-direction.md).
- Source: server/codex-worker.ts; server/projects.ts; server/process.ts; server/windows/; shared/workflow.ts; server/store.ts; server/runner.ts; server/index.ts; web/.
- Tests: test/; e2e/; scripts/real-browser.ts; scripts/real-recovery.ts.
- Real browser evidence: .state/real-tests/browser-real-result.json; isolated server .state/real-tests/browser/8c78115e-09c9-4f53-90e4-8f250a0e6337/.
- Final real recovery evidence: .state/real-tests/recovery/481d073b-845b-4a5a-b404-d40f5af78dcb/result.json.

## Questions

- Saltwake remains outside configured intake; its toolchain and task scope require a separate bounded project qualification.
- Service/reboot persistence, unattended recovery, Claude workers, workflow designers, publishing and PMT/HQ runtime adapters remain outside this local real-testing slice.

## Plan

### Architecture

Use a configured Codex Worker behind the existing Runner/Store state machine and a mixed real/simulated dashboard. Clone configured repository revisions into separate task workspaces with separate Git metadata and no hardlinks, or copy the built-in fixture. Keep source integration separate. Native Windows Job Objects own suspended commands before execution; kill-on-close and owner monitoring bound lifetime. Only a drained receipt or authoritative named-job disappearance can release interrupted work.

### Models

Persist execution/project identity, exact candidate tree, source author, role assignment, plan, review finding, operator resolution, cancellation intent, reconciliation requirement and technical-resolution count. Worker replies allow only current-stage actions, avoiding contradictory routing flags. File configuration selects role instructions, source project/ref, protected files, verification argument arrays and state capacities. Code-generated artifacts, credentials and raw model logs stay under ignored .state.

### Workflow

1. Create a real or simulated execution task through the UI. Lead routes ready work or BA refinement; internal routing is not an operator blocker.
2. Reserve role/state capacity transactionally and execute the assignment in its own workspace and owned job.
3. Run independent verification, check source preservation and capture the actual Git tree. Reviewer inspects a separate read-only snapshot.
4. Route findings to Builder fixes, routine technical blockers to bounded Lead resolution, and product/authority/recovery uncertainty to the operator.
5. Cancel only after native drain; preserve and reconcile interrupted attempts before another writer. Invalidate stale source and return to verification.
6. Qualify normal/mobile UI, actual browser-started team workflow and repeatable real failure scenarios in isolated test servers/databases.

## Evidence

2026-10-23: final typecheck/build PASS; 15 local tests PASS; four headless Edge dashboard tests PASS; npm run test:real PASS in approximately 2.7 minutes (task acc7cf77-fe6a-4f8f-a0d9-6e6c441ca494, six distinct Lead/BA/Builder/Reviewer sessions, two review rounds). npm run test:recovery PASS: a seeded technical blocker received real Lead resolution; actual writing-worker cancellation stopped later writes; a deliberately killed coordinator stopped its writer; restart held work with no duplicate; reconciliation preserved files; a stale review was refused; fresh verification/review completed the task. The latest result is 481d073b-845b-4a5a-b404-d40f5af78dcb. Dev server and Vite API proxy smoke passed on 4111/5174; normal built server is left running on 4111.

The process tests also prove optional workspace-write verification creates a local build artifact while refusing a sibling canonical canary write. Configured local-repository tests preserve original bytes and HEAD while task changes produce another tree.

Earlier qualification failures exposed and corrected an inaccessible cross-user process start timestamp, a TypeScript strip-only helper syntax issue, and ambiguous generic worker replies. A proposed model-instructed technical fault did not exercise that branch; the repeatable test now seeds the blocked state explicitly and qualifies the real Lead response. Failed evidence is retained and excluded from passing results.

Saltwake was not configured or transferred. Main application files remain uncommitted; no remote publishing or production merge occurred. Status remains backlog/unassigned.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

