# Workflow contract

## Workflow tasks and PMT tickets

BRK-015 moves actual start states, persona assignments, events, guards, artifact handoffs and final states into `config/workflows.json`. The runner interprets this graph; executors retain native source/process/review rules. See [Workflow configuration](workflow-configuration.md) for the schema and examples. Each new task pins its graph and persona contents, and exposes state handoff history. The delivery graph explicitly routes Lead → BA → Builder → Reviewer rather than relying on the earlier fixed pipeline to pick the next role.

BRK-014 makes each new task an instance of a named workflow within the header's selected project. `config/workflows.json` defines presets and participants; its definition is copied into the run so later file edits do not change an active task. Personas remain separate files under `config/personas`. The current predefined kinds are discovery and epic delivery; a visual workflow designer remains deferred.

Product discovery / grilling hands the brief from Product Owner to Architect. Architect challenges return to the Product Owner; unresolved user decisions pause the task with concrete questions. User answers enter the persisted discussion before continuing. Once ready, the Architect produces a specification and the Project Manager proposes an epic/ticket plan. The runner initializes project-local PMT when needed and publishes the spec, epic and tickets. Discovery completes there and starts no coding tickets. The configured automatic-exchange budget pauses a stalled discussion for direction.

The Tickets view reads and edits canonical PMT files. Writes use revision checks and validation, and active epic delivery holds edits to its scope. PMT's parent-workspace discovery is guarded: its config and output paths must remain inside the selected project. Publication checkpoints item IDs and embeds recovery markers so a repeated handoff reuses existing items.

Epic delivery starts only when the operator selects an epic and explicitly starts another task. The Lead coordinates its dependency-ready tickets, each passing BA, Builder and independent Reviewer. Tickets run sequentially within an epic; configured state capacity can serve other tasks concurrently. Each new ticket copies the exact previous approved source tree into another isolated workspace, refusing a changed predecessor. PMT status follows normal backlog → todo → in-progress → complete transitions. Complete requires every targeted ticket to pass verification/review. The last ticket workspace contains the final candidate; source integration remains separate.

Workflow runs, discussions, questions, child tickets and handoffs persist in SQLite. Cancellation drains owned work and retains files. Restart holds interrupted workflows for explicit reconciliation. Simulated workers are fixtures for internal tests and cannot be selected or submitted through product task creation.

## Delivery ticket state machine

BRK-009 introduced the state machine; BRK-011 connects real Codex workers, configured local projects and owned-process recovery. Every assignment and accepted result is recorded in SQLite. Task state and history change in the same transaction.

## States and transitions

| State | Executor | Accepted result or action | Next state |
|---|---|---|---|
| queued | Lead | Scope ready | ready |
| queued | Lead | Scope needs refinement | refining |
| refining | BA | Scope and acceptance criteria ready | ready |
| ready | Runner | Builder capacity reserved atomically | implementing |
| implementing | Builder | Verified candidate revision | reviewing |
| implementing | Builder | Verification fails | blocked, resume implementing |
| reviewing | Reviewer | Exact verified candidate approved | complete |
| reviewing | Reviewer | Changes requested | implementing |
| reviewing | Reviewer | Configured review budget exhausted | blocked, resume implementing |
| Any working state | Assigned worker | Blocker or execution error | blocked, preserving interrupted state |
| blocked, technical | Lead within configured budget | Actionable resolution | saved resume state |
| blocked | Operator | Resolution or reconciliation note | saved resume state |
| Any nonterminal state | Operator | Cancel | cancelled |

Complete means verification and independent review passed against the same candidate revision. Integration remains a separate authorized operation. Real workers return role-specific actions: ready/refine, refined, implemented, approved/changes, resolved, or a classified blocker. The runner performs verification and binds results to source. Simulator candidate revisions and checks are fabricated fixtures and provide no evidence about repository code.

## Assignment rules

Builders implement and Reviewers review. The role is bound when claiming the assignment; review also checks candidate revision and non-author identity. Each task has at most one running assignment. Duplicate or cancelled results do not advance it. Invalid results leave the task and history unchanged.

`config/workflow.json` sets state parallelism. Omitted state capacities default to one. For example, set `implementing` to `2` and leave `reviewing` at `1` to run two builds alongside one review. Restart to apply file changes.

Parallelism controls simultaneous executions within a state, not the number of cards waiting there. Queued Lead work, BA refinement, implementation, review and eligible technical-blocker Lead resolutions execute assignments. Ready is a waiting state; terminal states have no automatic execution. There is no hard-coded team size.

`maxReviewCycles: null` leaves review cycles unbounded. A configured positive budget blocks work after that many unsuccessful rounds. A numeric review default has not been adopted. `maxTechnicalResolutions` defaults to one Lead resolution attempt per task and is configurable; product/authority questions, recovery uncertainty and exhausted budgets remain operator blockers.

## Pause, cancel and recovery

Pause persists across restarts and prevents new claims. Running assignments can finish. Cancel persists an intent and keeps capacity occupied until the owned job drains. Only then does the task become cancelled. Uncertain cleanup leaves a blocked reconciliation hold; late results cannot advance cancelled work.

Only one runner may own the SQLite database. Real commands launch suspended into a kill-on-close Windows Job Object before execution. A host monitors the exact coordinator identity; cancellation or owner loss terminates the job. Reconciliation requires a drained receipt or authoritative disappearance of the named kernel job. On startup, interrupted assignments stay blocked and reserve capacity until checked. Existing files are preserved; a changed review candidate returns to implementation and verification. This version uses explicit operator reconciliation rather than unattended restart of interrupted work.

## Storage and UI

Local state is ignored under `.state/barracks.db`, with source copies and process receipts under `.state/tasks/`. The frontend polls the runner, which keeps executing independently of the browser. Child execution history is append-only. Workflow records contain their definition, discussion, user answers and PMT/child references. The dashboard creates real workflow tasks and edits project-local PMT items.

The server binds to 127.0.0.1 and accepts only the known loopback origins. This is a local operator application with no multi-user account boundary. Native Codex authentication stays with its CLI. Configured source repositories are copied at a committed revision; integration, publishing and merges remain separate authorized operations.
