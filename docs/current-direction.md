# Current direction

2026-10-24: assignment supervision replaces the short default deadline. Agent assignments inherit no elapsed-time cap by default, with optional workflow-state overrides. Inactivity produces visible attention without terminating the worker. Repeated identical command failures and unchanged review findings use configured Lead recovery; the new default delivery graph includes bounded candidate-level recovery for acceptance and retrospectives. Individual verification deadlines, explicit cancellation, owner-loss cleanup and reconciliation remain enforced. Existing task snapshots retain their routes, while the runtime deadline default applies when a saved state is retried. See [assignment supervision](workflow-configuration.md#assignment-supervision).

2026-10-23: the default workflows now adapt Matt's discovery-to-delivery approach. Discovery separates grilling/challenge, specification synthesis, user review of the specification/test seams, ticket drafting and user review before PMT publication. Delivery isolates ticket answers and follows BA, implementation/TDD and independent Standards/Spec review with cumulative exact-candidate acceptance and a retrospective. Acceptance failures reopen the candidate-owning ticket for fixes and fresh review. These are runner-controlled methods and explicit gates; full external skill-package loading remains separate. Existing tasks retain pinned graphs. See [workflow configuration](workflow-configuration.md).

2026-10-23, BRK-015: workflow definitions now own actual state-machine graphs. Tasks keep the current state and handoff artifacts; the runner interprets transitions and enforces native execution safety. Personas remain separate and their contents are pinned into each task with its graph. See [Workflow configuration](workflow-configuration.md). Persona/workflow management UIs can build on this definition model; those editors remain the next slice.

2026-10-23: tasks are instances of named real workflows in the selected project. Product discovery / grilling uses Product Owner, Architect and Project Manager to produce a specification and editable project-local PMT epic/tickets, asking the user only for unresolved decisions. A separately started Epic delivery task coordinates Lead, BA, Builders and Reviewers against the selected epic. Every ticket passes BA; accepted source carries forward between tickets. Project context comes from the header. Simulation is retained only for internal tests. See [workflow contract](workflow.md) and [glossary](../GLOSSARY.md); earlier single-pipeline framing below records the implementation history.

2026-10-22: the user identified Barracks as a state machine and requested separation of current work from earlier artifacts.

## Operating model

A persisted task state machine controls assignments and transitions. Coding workers execute bounded assignments using configured personas and tools. Results include the source checkpoint and evidence needed for the next permitted action.

Workers have separate Lead, BA, Builder and Reviewer responsibilities. Builders implement; Reviewers review. Each workflow state has configurable parallelism, defaulting to one. Capacity is configuration rather than a fixed team size. Parallelism limits concurrent task assignments in that state; a task advances only after its assignment returns an accepted result. PMT owns task scope/status; Headquarters holds decisions and evidence.

## Adopted workflow policies

2026-10-22, confirmed by the user:

- The Lead may send a sufficiently specified task directly to implementation; BA refinement fills missing scope and acceptance criteria.
- Completion requires verification and independent review of the exact candidate revision. Integration is a separate authorized action.
- Use Vite/React, a separate Node/TypeScript runner and SQLite, running locally with file-based configuration initially.
- Builders build and dedicated Reviewers review. State parallelism is configurable and defaults to one. The earlier interchangeable Builder/reviewer roster is superseded.
- Connect the previously verified native Codex executable first; add Claude after the full cycle works.
- Reconcile interrupted attempts before resuming automatically when safe. Pause prevents new assignments while running work finishes; cancel explicitly stops a selected job.
- The Lead resolves routine technical blockers within its authority and escalates product ambiguity, authority changes and exhausted recovery paths to the user.

The earlier proposed three-cycle review limit was not adopted; the retry budget remains to be defined in workflow configuration.

## Initial scope

- One project and configured workflow at a time.
- Local repository and worktrees, using the existing coding tools.
- Automatic assignment and handoffs through refinement, implementation, review and fixes.
- Persistent attempts, results and transition history.
- Dashboard with task progress, worker activity, logs and blockers.
- Start, pause dispatch, cancel and answer-blocker controls.
- Recovery that reconciles interrupted attempts before permitting another writer.

Personas and workflow configuration remain separate. The workspace Library manages persona instructions and a structured workflow state/handoff editor with a graph preview. A drag-and-drop designer remains deferred. [Workflow configuration](workflow-configuration.md) describes the executable graphs and native executor contracts. Product task creation uses real workers; simulation is an internal fixture.

The Tickets view groups PMT tickets into status columns and refreshes progress automatically. Persona stages and attention markers remain separate from the canonical PMT status. Selecting a ticket opens a right-side drawer with its content, dependencies and execution history; the drawer fills a narrow screen. Editing retains revision checks and is locked during active epic delivery. Workflow execution owns status changes; the board has no drag-to-move control. A rebuilt UI can use the existing runner APIs while an active assignment finishes; after the next normal restart, the dedicated board endpoint supplies configured PMT columns as well as observed statuses.

## Proposed implementation

React with Vite provides the dashboard. A separate Node/TypeScript runner executes work independently of the browser. SQLite stores task state, assignments, attempts and pending handoffs. A direct state-machine implementation can express the initial workflow; adopt additional orchestration libraries when a concrete requirement justifies them.

BRK-009 scaffolded this stack with a simulated adapter; BRK-010 supplied the first bounded real-worker proof. BRK-011 now connects real tasks to the dashboard, configured local project copies, role-specific decisions, owned Windows jobs and explicit reconciliation. [Testing guide](testing.md) describes the current commands and limits. PMT/HQ runtime adapters and project-specific Saltwake toolchain qualification remain separate work; Saltwake intake is not enabled.

## Historical evidence

The [archive](../archive/2026-10-22/README.md) preserves earlier code and qualification results. The execution ledger and launch broker may supply reusable patterns. Their previous test results establish historical fixture behavior, not qualification of the new application. Reuse follows inspection and verification in the new context.

The earlier Factory starter adoption is superseded by the custom state-machine direction. Existing PMT story IDs and statuses are preserved for traceability and require reassessment before assignment. Saltwake's existing coordinator and worktrees remain independent of this cleanup.
