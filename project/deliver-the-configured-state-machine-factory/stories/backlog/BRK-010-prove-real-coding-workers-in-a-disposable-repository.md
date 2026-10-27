---
schema_version: 4
type: story
id: BRK-010
epic: BRK-E10
title: Prove real coding workers in a disposable repository
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

# Prove real coding workers in a disposable repository

## Summary

Run the Barracks state machine with real native Codex Builder and Reviewer sessions against a tiny isolated fixture before any Saltwake intake.

## Acceptance Criteria

- [x] Create a disposable local fixture with an expected failing baseline and no Saltwake dependency.
- [x] Execute real native Codex Builder and dedicated read-only Reviewer assignments through the existing Runner/Store/state transitions.
- [x] Demonstrate a real rejection, automatic Builder fix handoff and independent approval in distinct sessions.
- [x] Execute checks independently in the sandbox and bind each review to a captured Git source tree.
- [x] Preserve protected fixture files and refuse unrelated roots or unexpected edits.
- [x] Retain per-attempt process/session receipts, prompts, structured replies, checks and persisted history.
- [x] Record failed attempts separately from the passing run and state qualification limits.

## References

- [Proof contract, command, outcome and limitations](../../../../docs/codex-proof.md).
- [State-machine contract](../../../../docs/workflow.md).
- Source: server/proof-worker.ts; scripts/qualify-codex.ts; config/personas/; test/fixtures/slug-repo/; test/proof.test.ts.
- Local evidence: .state/qualification/5bf68078-0141-4d6a-a946-07de723793bd/result.json.
- [Official Codex non-interactive invocation](https://developers.openai.com/codex/noninteractive).
- [Official Windows sandbox configuration](https://developers.openai.com/codex/windows).

## Questions

- Real cancellation, orphan reconciliation and safe restart remain before production intake.
- This proof skips BA refinement and uses deterministic Lead routing. It establishes Builder/Reviewer handoffs, not full-team reasoning or production capacity.

## Plan

### Architecture

Use an opt-in Worker implementation restricted to the checked-in slug fixture copied beneath .state/qualification. Reuse the ordinary Runner, Store and transitions with a separate SQLite database. Ordinary dashboard tasks stay simulated. Keep the native Codex CLI responsible for authentication and sandboxed execution.

### Models

Each attempt records role, assignment, PID/start timestamp, distinct Codex session, requested sandbox, exit receipt, structured response, checks and candidate source tree. Git object storage sits outside the writable workspace. A copied Node executable remains within the disposable proof root because the sandbox cannot launch the NVM profile binary directly.

### Workflow

1. Require baseline assertion failures before a model is invoked.
2. Builder implements slug behavior; independently execute the protected tests and capture the real tree.
3. Reviewer inspects a separate read-only candidate snapshot and requests intentionally staged regression coverage.
4. Fresh Builder adds the requested test; independently verify and capture a changed source tree.
5. Fresh Reviewer approves the revised candidate; require four distinct sessions and two review rounds.
6. Preserve all evidence. Bound attempts to 180 seconds, total run to 15 minutes and this experiment to three unsuccessful review rounds. These bounds do not change application defaults.

## Evidence

2026-10-22 local: PASS, run 5bf68078-0141-4d6a-a946-07de723793bd, task f1fa2d43-7de6-4c10-a875-a9f52ac60c53. Four distinct gpt-6.1-sol Codex sessions completed two review rounds in approximately two minutes. Initial tree fba9fba522c2ed5bb056576d6da915034772abac changed to approved tree a1773c6a6ce6b74973379a8a8386e2f9eaa00104. Final sandboxed suite passed all four tests. Session turn-context metadata confirms Builder workspace-write, Reviewer read-only and approval never. Typecheck, eight local tests and Vite build PASS.

Earlier failures are retained: one sandbox Node launch failure and three read-only Builder invocations before explicit Windows sandbox selection corrected the adapter. None count as passing qualification. No main application commit, remote operation or Saltwake intake occurred. Real process cancellation/orphan recovery and production isolation remain unqualified. Story status remains backlog/unassigned; all changes are uncommitted.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

