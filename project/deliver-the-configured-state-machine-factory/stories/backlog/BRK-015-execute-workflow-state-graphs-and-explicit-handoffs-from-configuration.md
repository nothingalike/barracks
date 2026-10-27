---
schema_version: 4
type: story
id: BRK-015
epic: BRK-E10
title: Execute workflow state graphs and explicit handoffs from configuration
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

# Execute workflow state graphs and explicit handoffs from configuration

## Summary

Make workflow definitions own initial state, persona assignments, events, guards, handoff artifacts and terminal states while keeping executor safety checks in the runtime.

## Acceptance Criteria

- Workflow JSON declares its initial state, agent/human/operation/final states, persona bindings, events, handoff targets, guards and artifact mappings.
- Changing state names, the initial persona or routing requires configuration edits rather than persona-specific branches in the runner.
- Required/optional inputs and emitted/cleared artifacts form explicit handoff contracts. Persist each accepted transition with event and artifact names.
- Default delivery routes Lead, BA, Builder and Reviewer through configured states. Native source, verification, process and independent-review checks remain enforced.
- A task pins its graph and persona contents. Configuration/persona edits affect future tasks. Preserve historical data and hold unversioned unfinished records rather than silently reinterpret them.
- Validate graph targets, human-answer/resume links, completion reachability, output ownership and bounded invalid-output recovery.
- Keep the product name Task; document Workflow, State, Handoff and Task runner. Persona/workflow management editors are the next slice.

## References

- None.

## Questions

- No remaining questions.

## Plan

### Architecture

Separate a pure state-machine interpreter from bounded executors. Shared graph schemas and transition/input functions validate definitions and events. The task runner loads the initial state, dispatches the declared executor and follows the configured handoff. Conversation response schemas/prompts derive from state events and inputs. Ticket executors reuse native permissions and candidate/review checks; coordinated executions are excluded from the legacy automatic dispatcher. PMT publication/selection/acceptance remain explicit operation capabilities rather than implicit persona branches.

### Models

Definitions carry schemaVersion 2, initial, states, persona references, instructions, required/optional inputs, on-event handoffs, output/clear bindings, guards, parallelism and budgets. Tasks persist their current state ID in phase, lifecycle status, artifacts, pinned persona contents, handoff history, saved resume state and retry counters. Graphs own routing; personas own worker behavior; executors own permission and verification enforcement. GLOSSARY.md records the adopted names.

### Workflow

1. Validate the workflow definition and load its referenced personas into the new task snapshot.
2. Enter the configured initial state and project only its declared inputs to the executor.
3. Validate the returned event/guard/output contract, persist artifacts and the handoff, and enter its target.
4. Human answers and source-change recovery follow configured events; $resume consumes an explicitly remembered state.
5. Default grilling publishes PMT outputs through an operation state. Default delivery selects and independently reviews each ticket through declared worker states.
6. Prove arbitrary configuration-only routing, snapshot pinning, native worker safety and real graph-driven two-ticket delivery before applying to the normal app.

## Decisions

2026-10-23, user: keep Tasks as instances executing a Workflow, which is a state machine. A Task tracks state and coordinates workers from that definition and their individual personas. Wire the state graph first; persona and workflow management UIs follow. SQLite was already present through node:sqlite for coordination state; PMT files remain canonical for tickets.

## Evidence

Build/typecheck and 24 local tests pass. Twelve isolated browser cases pass. New tests start discovery with another persona, add a human gate, rename states and terminal states, change delivery routing, bind an Architect persona to the Reviewer execution role, and confirm those changes run without runtime edits. Graph/persona file edits leave the active task's snapshots unchanged. Validation rejects dangling/unreachable/trapped states, invalid resume/human events and runner-context output replacement; guarded approval and bounded invalid_output handoffs are exercised. Existing PMT/source/process/recovery tests continue passing.

Real configured discovery 6f45a807-224a-4af0-a960-a56e09f909d4 produced a specification and two tickets. Its first PM structured reply used an invalid dependency index; validation held the task before publication. Explicit schema-correction feedback resumed the same pinned state graph. The default PM state now declares one invalid_output retry with executor_feedback, qualified deterministically. Delivery 051fba41-1af4-48ee-811d-c075424e868f then completed both real Lead/BA/Builder/Reviewer sequences through configured handoffs, retained cumulative source, and passed an independent final test invocation. Evidence: .state/factory-real/c2aba5ba-fec3-4ed3-b6a1-8e5165943e64/discovery-resumed.json, delivery.json and graph-handoffs-complete.png. This is a recovered discovery qualification and a completed configured delivery, not a claim that the original test command passed on its first attempt.

All Git/PMT/model qualification writes were isolated to disposable fixtures. No Saltwake intake, source integration, remote publication or Barracks commit occurred. Native folder navigation retains its prior manual-check limit. The current product still uses file-based workflow/persona configuration; management editors remain next. Story stays backlog/unassigned.

## Work History

### 2026-10-24: supervision replaces default assignment timeout

User approved removing the fixture-derived three-minute assignment cap. Runtime `attemptTimeoutMs` now defaults to null; the Windows host and JavaScript waiter both honor no deadline. Agent states can inherit, disable or set a custom deadline through the Library. Verification commands retain their 60-second limits. Ten minutes without observed output or workspace changes raises dashboard attention while the agent keeps running.

Assignment activity records include elapsed/idle time, output events, completed commands and observed file changes. API projection combines observations with current lifecycle and drained receipts so interrupted work is not labeled running. Three consecutive identical failed commands without observed edits/successful commands drain the job and raise a technical blocker. Three unchanged review findings also route to Lead, with implementation/verification required before review resumes. New delivery graphs include bounded read-only Lead recovery for acceptance and retrospective command loops; existing pinned routes are preserved.

Validation: 48 local tests, typecheck/build and 17 isolated Edge cases passed. Native tests cover unlimited cancellation, warning-only inactivity, repeated-failure draining, finite command deadlines and owner-loss reconciliation. Integration tests cover review-loop recovery and acceptance/retrospective Lead recovery/exhaustion. Independent Standards/Spec reviews found stale activity projection, cancellation precedence and missing workflow-level Lead routes; fixes were rechecked with no unresolved findings.

Idle session-owned runner PID 23988 was replaced by PID 28452. Held todo-app run f9d939fb-b4d3-40d2-b3a2-0f83da969943 was reconciled and resumed in its existing child workspace 4dcdfc62-aa06-437e-9aa3-812f06223f29. Its new Builder assignment 264b4aa9-33e7-429f-ae35-19d61c7ad6ee records maxRuntimeMs:null and live running activity. Cancelled runs remain cancelled. This proves live activation/resumption, not completion or acceptance of todo-app. Work remains uncommitted and story status unchanged. Review: http://localhost:4321/f/barracks/stories/BRK-015/reviews/2026-10-24-assignment-supervision.

Subsequent live check: the resumed Builder completed with independent verification, and the same run advanced to review (Reviewer assignment d2897c3b-8e06-41db-9199-e72333eb4926). Edge smoke of the live run screen passed. This establishes progress through this ticket's implementation/verification; independent approval and cumulative epic acceptance remain separate evidence.

### 2026-10-23: realistic delivery-context reservation fix

Todo-app delivery b93baf91-7672-43d8-b03c-817047956d0c failed before dispatch because the selector packed 21,550 characters of epic/specification/ticket context into a child description capped at 10,000. It also moved PTODOAPP-001 to in-progress before child creation succeeded. The failing path was reproduced using the actual approved records and an in-memory Store.

Child descriptions now carry bounded epic/ticket references; the complete approved context remains in structured workflow handoffs. Store reserves each child and its parent-run reference in one SQLite transaction before PMT status advances. Failed PMT transitions retain the reservation, and retry reuses it. Three regressions first failed against the old behavior and now pass: full context above the description limit, rollback after child insertion, and PMT-transition failure/retry without duplicate children. All 36 local tests and typechecking passed.

Both user delivery attempts were found cancelled during activation checks and were preserved as cancelled. The idle session-owned main runner was reloaded from PID 93980 to PID 23988; live API verified those cancellations and the completed discovery record. No replacement delivery was started, so a new actual todo-app delivery remains unverified. Work is uncommitted and story status unchanged. Review: http://localhost:4321/f/barracks/stories/BRK-015/reviews/2026-10-23-delivery-context-fix.

### 2026-10-23: Matt-style default workflow follow-up

User requested applying the reviewed Matt approach to both workflows. Discovery now separates challenge and specification, returns questions to their originating state, and requires explicit specification/test-seam and ticket-plan review/revision before PMT publication. The dashboard shows review inputs and submits a configured approval or changes event. Delivery clears ticket-specific answers/questions, preserves mandatory BA and independent Standards/Spec review, then assigns Acceptance Tester and Retrospective Analyst.

Acceptance uses a read-only copy of the final accepted child candidate, reruns its fixed verification plan and requires evidence for every ticket criterion ID. Missing capabilities remain unverified. Acceptance defects reopen the child owning the candidate, including epics with trailing pre-completed tickets; fixes require verification and independent review again. Interrupted verification jobs are reconciled and a partially checkpointed repair can be replayed safely. Non-planning worker schemas require plan:null after a real Architect response attempted premature ticket planning.

Validation: 33 local tests, typechecking and production build passed. Sixteen isolated Edge cases passed, including the new review controls, narrow layout and restart persistence. Independent Standards and Spec source reviews identified recovery/selection issues; their fixes and focused interruption tests were rechecked. No committed diff baseline exists in this checkout, so those reviews cover the explicit changed-file scope. Real qualification is tracked separately below when complete. Story status and integration authority remain unchanged; work is uncommitted.

Real qualification passed after retained discovery recovery: discovery 458fade9-b77d-496b-ba5f-d0f985d5a4c5 completed explicit specification/test-seam and ticket-plan fixture approvals; delivery f638124d-a9ec-4d7a-93ea-152ffa3645ed completed two real BA/build/review tickets, cumulative acceptance for all 12 ticket criteria and a retrospective. The final independent greeting test run passed six tests. Source isolation remained intact. Evidence: .state/factory-real/bbd85f0a-803a-4191-a081-fd0d309de357/{discovery-recovered.json,delivery.json,result.json}. The initial command stopped on an invalid premature planning response and is not reported as an uninterrupted pass.

User approved restarting the existing main runner after this proof passed. PID 24592 was replaced by PID 93980. Live API and Edge Library smoke verified nine personas and the updated 9-state discovery / 13-state delivery definitions, including acceptance and retrospective assignments. Existing pinned tasks were preserved. Review: http://localhost:4321/f/barracks/stories/BRK-015/reviews/2026-10-23-2235-matt-workflows. Non-Node, device and production journeys retain their own qualification requirements.

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

## Loop investigation, 2026-10-24

The user reported apparent nonprogress in todo-app delivery run `aa4ae054-ed7e-4380-b353-35ce61118890`. With user authorization, `/api/pause` set the global dispatch pause. The last assignment drained; the live snapshot then showed no running assignments, phase `build`, 41 review rounds and zero accepted tickets. Preserve this pause until the user authorizes resumption.

Evidence and findings:

- PTODOAPP-001 repeatedly returned the same candidate `75f2c27720e663a24d4cce88e1aeb53404578bf5`. `.state/detect-delivery-loop.cjs` reads the actual APIs and fails on repeated completed reviews of the unchanged candidate; its captured evidence is `.state/delivery-loop-evidence.json`.
- Recent Reviewer findings repeatedly requested browser/build verification and verifiable candidate/baseline evidence. Recent Builders reported no source changes and passing checks.
- `server/codex-worker.ts:24-28` copies tracked source into the review directory without a Git repository or candidate/baseline receipt. The model receives the candidate hash but cannot resolve it in its snapshot; its Git commands walk up to the Barracks repository instead.
- The model returns its verdict before independent verification runs (`server/codex-worker.ts:34-58`). The prior Builder and Reviewer assignments both have exit code 0 receipts for board tests, browser checks and build. These receipts are outside the supplied snapshot/handoff. They do not retroactively change an already-returned rejection.
- `shared/workflow.ts:74-75` detects only whitespace-normalized equality of complete review prose. A replay of six actual paraphrased rejections through `advance` left `repeatedReviewFindings` at 1 on every cycle. `.state/replay-review-loop.ts` fails its intervention assertion; output is `.state/review-loop-replay-result.json`.

Recommended next slice: provide independent verification and candidate/baseline evidence before the Reviewer verdict, distinguish environment/evidence blockers from code-change requests, and route unchanged-candidate nonprogress to configured Lead recovery. Prove those behaviors in an isolated regression/worker fixture before any restart or resumption. Diagnosis only: application code and source candidates remain unchanged. The deferred SQLite Library epic remains deferred.

## Review evidence repair and live process refinement, 2026-10-24

The user authorized using todo-app as a guinea pig, applying needed runner edits and reviewing the process as work advances. SQLite Library migration remains deferred.

- Added `server/review-evidence.ts`: a separate review Git object store/index contains both candidate and baseline trees, including unborn/empty predecessors. The snapshot has no source remote or writable Git link. A baseline diff and runner evidence are available inside its own `.git` metadata.
- `CodexWorker` runs the independently configured checks before the Reviewer model starts, with their original command permissions. The prompt receives candidate-bound results and exact local tree/diff evidence; failed checks become technical blockers before a verdict. Model access stays read-only, and source/candidate changes still invalidate results.
- Added persisted unchanged-candidate review counters. Three consecutive rejections of one tree reach the existing technical Lead route even when findings are rephrased; a changed candidate begins a new count, and Lead resolution resets intervention counters. This is a nonprogress guard, not a new wall-clock deadline or total review limit.
- The captured six-round replay previously failed its intervention assertion; it now reaches a technical block after the third unchanged-candidate rejection. New worker-seam tests cover ordering/evidence, independent verification failure, verification source edits, concurrent canonical-source changes and model edits. The path fixture includes spaces, and the generated Git command quotes safe.directory.
- Standards and Spec reviews found no blocking issues. Standards identified the quoted-path issue, which was corrected. Mocked process checks establish control flow; native qualification is separate.
- Disposable native Reviewer proof passed: `.state/review-repair-proof/b2e93ccc-758f-4ffc-81db-a1aa9911b585/result.json`. Both candidate/baseline resolved; runner tests and a write-capable build passed before the Reviewer verdict; the read-only Reviewer approved with evidence, source unchanged.
- Full local run: 56/57 passed, with one Windows EPERM rename in a disposable PMT fixture. Both cases in that file passed on rerun; all 57 unique cases are qualified. Typecheck and Vite build passed. This transient is preserved in the command log rather than hidden as a clean first pass.
- Verified old owned runner PID 28452 was paused and drained, backed up `.state/barracks.db` to `.state/main-runner/backups/review-repair-20261024/`, then restarted as PID 15528 and resumed dispatch. The paused run was already queued; no reconciliation mutation was required.
- Live proof: PTODOAPP-001 candidate `75f2c27720e663a24d4cce88e1aeb53404578bf5` was independently approved on the first new review after the fix, at review round 42. PMT completion persisted, and PTODOAPP-002 advanced through Lead to BA. No source fix or acceptance waiver was used to bypass the loop.
- Future Reviewer persona guidance and `docs/testing.md` explain evidence ownership and technical blockers. The existing real-workflow browser harness now chooses Edit details before editing a ticket in the drawer.
- Added `test/review-recovery.test.ts`, which exercises the actual coordinated delivery route: three paraphrased rejections of one candidate -> technical Lead recovery -> rebuild -> fresh independent review -> completion. It passes, bringing the unique qualified local cases to 58; typecheck also passes with the added case.
- Second live proof: PTODOAPP-002 review identified a real lost-draft bug when switching cards after a failed rename. Independent inspection of the immutable review snapshot confirmed the defect against the ticket. The Builder retained drafts/retry state per task and added a browser regression that failed before the fix. A new candidate `79a8cb3257268dac368b69386c17e1faca58936b` passed review, with 9 board tests, browser checks and build. The run accepted the second ticket and started PTODOAPP-003. Delivery and cumulative acceptance remain in progress; this checkpoint establishes resumed progress and a real review/fix/re-review cycle rather than full epic completion.
- Implementation review: http://localhost:4321/f/barracks/stories/BRK-015/reviews/2026-10-24-1145-review-evidence-repair

## Final acceptance and project-folder handoff, 2026-10-24

The user observed all six tickets complete while the associated checkout contained no application code. All six ticket reviews had completed, but final acceptance was waiting on candidate mapping and verification evidence. The code remained in the final private task workspace. User expectation: finished source belongs in the associated project folder. The user explicitly authorized copying accepted code into `C:/Users/johns/source/repos/todo-app` as uncommitted files after acceptance.

- Captured the failed acceptance prompt and replayed an assertion proving candidate mapping and actual verification results were absent. Successful browser/build command receipts existed, but the old prompt exposed only command definitions and log paths.
- `DiscoveryAgent` now shares the self-contained Git snapshot helper and supplies candidate-bound exit codes/output to acceptance before its verdict. Its native read-only boundary and every-criterion validation remain enforced; no acceptance waiver was used. Retrospective/Lead contracts distinguish retained evidence from fresh verification.
- Added a prominent Code and delivery view: ticket review count, final acceptance, generated files, build path, configured project path and verified project-file presence. The board explains that Complete is ticket review and links to delivery/source details. Missing output artifacts preserve history; source drift prevents a reviewed-match claim.
- Standards/Spec reviews identified drift matching, missing-artifact failure and false receipt claims for other executors; all addressed. Regression checks cover matching-but-unreviewed source/project edits and absent Git metadata. 61 local tests, 21 isolated Edge cases, typecheck and build passed; affected checks reran after edge corrections.
- Restarted the paused/drained owned runner with database backup under `.state/main-runner/backups/acceptance-handoff-20261024/`; current runner PID 91276. Native acceptance passed all 41 criteria on unchanged candidate `6e062398e2509d63865d4c8c8287f271662f913c`; retrospective completed and run `aa4ae054-ed7e-4380-b353-35ce61118890` is complete.
- The explicitly authorized transfer added 11 candidate files without overwriting existing content or touching Git/PMT directories. Verified source/destination hashes; receipt `.state/integrations/aa4ae054-ed7e-4380-b353-35ce61118890.json`. Source is uncommitted in the configured todo-app folder.
- From that actual folder: 14/14 board tests, real-browser checks and static build passed. An owned preview runs at `http://127.0.0.1:4173` (PID 44348). Browser inspection confirmed editable app, no exceptions, no narrow overflow, and Barracks reports acceptance passed / source present in project. Screenshots: `.state/accepted-delivery-evidence/`.
- Generic automatic working-tree publishing remains a separate implementation boundary. This qualification used the explicit user-approved transfer; future delivery design must return accepted source to the associated project rather than leave private staging as the only result. A cosmetic punctuation encoding artifact remains in the delivered candidate; it was not silently edited after review.
- Review: http://localhost:4321/f/barracks/stories/BRK-015/reviews/2026-10-24-1435-accepted-project-output
