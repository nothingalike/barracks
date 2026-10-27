# Configure a workflow state machine

Edit `config/workflows.json`. Each definition owns its initial state, state assignments, events, handoffs and completion rules. Persona instructions remain separate Markdown files in `config/personas`.

A **Task** is one execution of that definition. Its persisted `phase` field holds the current configured state ID; its separate `status` describes whether execution is queued, running, waiting or finished. The task runner coordinates workers and records each accepted handoff.

## Define states and handoffs

The configured grilling workflow begins with this state:

```json
{
  "initial": "develop_brief",
  "states": {
    "develop_brief": {
      "type": "agent",
      "persona": "product-owner",
      "executor": "conversation",
      "instructions": "Develop the brief and return brief_ready.",
      "inputs": ["task", "project", "discussion"],
      "optionalInputs": ["brief", "challenges", "answers"],
      "on": {
        "brief_ready": {
          "target": "challenge",
          "guard": "document",
          "outputs": {"brief": "document"}
        }
      }
    }
  }
}
```

This excerpt is part of the full definition, which must also include `challenge` and a reachable final state. A worker returns the event `brief_ready` and a document. The runner checks the guard, stores that document as the `brief` artifact, records the handoff and enters `challenge`. The next state explicitly names `brief` in its inputs. Workers return allowed events; they do not choose arbitrary destinations.

Renaming a state or rerouting a handoff changes the definition, not runtime TypeScript. The schema rejects missing initial/target states, unreachable states, states without a route to completion, invalid human-input/resume links, and changes to runner-owned context.

## State types

| Type | Configuration | Behavior |
|---|---|---|
| `agent` | `persona`, `executor`, `instructions`, inputs and `on` | Assigns the referenced persona to a worker capability. |
| `human` | Inputs, instructions and an `answered` handoff | Waits for the user, then follows the configured answer handoff. |
| `operation` | Operation `executor`, inputs and `on` | Runs a bounded host operation such as publishing PMT tickets. |
| `final` | Optional `requires` and `message` | Completes after required artifacts and runtime safety checks pass. |

Participants are derived from state persona references. An explicit `participants` list, when supplied, must match those references. A persona can appear in several states, and different personas can use the same execution role.

Each state's `parallelism` defaults to one and controls simultaneous tasks executing that state. Delivery remains sequential within an epic; each ticket inherits its approved predecessor source.

## Artifacts and guards

Tasks begin with `task`, `project` and `discussion` artifacts. Delivery also supplies its selected `epic`. `inputs` are required; `optionalInputs` are included only when present. A missing required artifact stops dispatch before a worker runs.

Each handoff's `outputs` maps artifact names to fields in the executor result. For example, `"specification": "document"` stores a document, and `"ticket_plan": "plan"` stores the structured PM proposal. `clear` removes artifacts that belong to the previous work item; the default ticket-selection handoff clears the old candidate, findings and implementation plan.

Supported guards are `document`, `questions`, `ticket-plan`, `verified` and `approved`. Structured plans are validated again by the PMT executor. Verification/review facts come from the native execution engine, not a model's claim. Configuring a shortcut cannot accept an unverified or unreviewed source candidate.

`remember: true` saves the source state for a later `"target": "$resume"` handoff. Using that target consumes the saved resume state. The default delivery graph uses it for technical resolution and user intervention. A stale reviewed source emits `source_changed` and follows that explicitly configured route back to implementation.

## Executor contracts

The default discovery follows Matt's methods: `grill-with-docs` discovery and technical challenge, separate `to-spec` synthesis, specification/test-seam review, `to-tickets` drafting, then ticket-plan review before PMT publication. Review states accept `answered` for approval and `changes` for revision. Product Owner, Architect and Planner can emit `needs_user`; the saved source state receives the answer. A specification change clears downstream approval and planning artifacts.

The default delivery uses `implement`/`tdd` methods in the Builder instructions and Standards/Spec axes in the independent Reviewer instructions. These methods are embedded in the persona/assignment contract; automatic loading and version pinning of complete external skill packages is separate work. The runner retains scheduling, permissions and publishing authority.

The answer endpoint accepts `{ "answer": "Include restart persistence", "event": "changes" }` for a review revision, or `event: "answered"` for approval/answers. The event must exist on the waiting human state. Approvals record the submitted text; an unrelated event cannot bypass a gate.

| Executor | Result events | Rules |
|---|---|---|
| `conversation` | Worker events declared in that state's `on` | Read-only source access; response schema and assignment are generated from the state. |
| `ticket`, role `lead` | `ready`, `refine`, `blocked`, `technical_blocker` | Native triage; the graph decides the next persona. |
| `ticket`, role `ba` | `refined`, `blocked`, `technical_blocker` | Native readiness verification. |
| `ticket`, role `builder` | `implemented`, `blocked`, `technical_blocker` | Source writes and independent verification. |
| `ticket`, role `reviewer` | `approved`, `changes`, `blocked`, `technical_blocker` | Exact-candidate, read-only independent review. |
| `resolve-technical`, role `lead` | `resolved`, `blocked` | Bounded by the state's `attemptLimit`. |
| `resolve-delivery` | `resolved`, `blocked` | Read-only Lead recovery on the delivered candidate, bounded per saved source state and candidate by `attemptLimit`. |
| `select-ticket` | `ticket_selected`, `all_done` | Selects a dependency-ready epic ticket and creates an execution owned by the state machine. |
| `accept-ticket` | `accepted` | Requires actual verification and independent approval; carries the source forward. |
| `acceptance` | `acceptance_passed`, `changes`, `blocked` | Copies the final accepted child candidate, independently reruns its fixed verification plan, and requests read-only user-journey evidence for every ticket criterion ID. Unverified criteria cannot pass. |
| `reopen-ticket` | `reopened` | Reopens the child owning the final candidate for acceptance repairs. The Builder must verify again and obtain independent review. Replaying the same repair checkpoint is idempotent. |
| `retrospective` | `retrospective_ready` | Read-only inspection of candidate and primary handoff/attempt/review evidence; returns proposed environment improvements. |
| `publish-tickets` | `published` | Requires `specification` and `ticket_plan`; writes project-local PMT and returns epic/ticket references. |

The native executor retains its permission, source-revision and review checks. It records execution results but does not select the next workflow state. Coordinated ticket executions cannot be claimed independently by the older direct-task dispatcher.

Ticket selection clears ticket-scoped answers, questions and findings. Durable project/epic decisions belong in their own context. After the last ticket, selection supplies the final source candidate, full ticket records and numbered acceptance criteria. The acceptance guard requires that exact candidate and every criterion to pass. Runtime/device capabilities still depend on the configured project and tools; missing capabilities produce a human wait instead of a passing claim. Acceptance source mutation requires reconciliation. Acceptance verification jobs and model jobs both require drained process receipts before replacement.

Child task descriptions contain short epic/ticket references; full approved context is passed through the configured structured handoff inputs. Reserving a child and its parent-run reference is one SQLite transaction. PMT advances to in-progress only after that reservation succeeds. A failed PMT transition retains the reservation, and retry reuses the same child before dispatching a worker.

Delivery completion requires acceptance and retrospective artifacts. Integration and release remain separate. A retrospective output or process failure holds the workflow for reconciliation; it leaves the already-recorded acceptance evidence intact.

Ticket execution capabilities require `kind: "delivery"`, which supplies the selected epic input. Conversation-only workflows can use different persona orders and handoffs without changing the runner.

## Retry and task snapshots

### Assignment supervision

Agent assignments have no elapsed-time deadline by default. In `config/projects.json`, `attemptTimeoutMs: null` selects that policy; a positive millisecond value supplies a runtime default. An agent state can set `assignmentTimeoutMs` to a positive millisecond value or `null`; omitting it inherits the runtime setting. The Library exposes these choices as Use runtime default, No deadline and Custom deadline (seconds). Independent verification commands retain their 60-second limits.

`inactivityWarningMs` defaults to 600000 (ten minutes). The runner records output events, completed commands, observed workspace changes, elapsed time and last observed activity in each assignment's `codex/activity.json`. Inactivity raises attention in the dashboard while the agent continues running. Silence can include reasoning, and activity is not proof of useful progress. The UI combines observations with process receipts and current lifecycle so an interrupted assignment is shown as needing reconciliation rather than running.

Three consecutive failures with identical command, exit code and output, without an observed intervening edit or successful command, trigger intervention. The owned process tree must drain before a ticket worker returns a technical blocker to its configured Lead route. Three unchanged review reports also trigger Lead intervention; `maxRepeatedReviewFindings` configures that threshold. These are conservative comparisons, not semantic diagnosis of every possible loop.

The default delivery graph routes acceptance and retrospective technical loops through read-only `resolve_delivery` Lead recovery. It remembers the interrupted state and supplies retained evidence; a resolution returns to that state. Its budget is one attempt per source state and candidate, after which a human resolution is required. Existing tasks retain their saved routes. Explicit cancellation takes priority over loop classification, and owner-loss cleanup and reconciliation remain required before replacement.

A conversation state can declare `maxOutputRetries` and an `invalid_output` handoff. The default PM state permits one correction and receives `executor_feedback`. This host-generated event follows its configured target; exhausted retries hold the task for reconciliation. Uncertain process cleanup and source changes remain recovery holds.

An optional `maxAutomaticExchanges` budget requires an `onExhausted` human state. The budget pauses a discussion for direction rather than silently completing it.

New tasks pin the validated graph and persona contents. Editing either file affects future tasks; it does not change an active task's assignments. Pre-graph records remain readable. An unfinished historical record without a pinned graph is held rather than silently reinterpreted under new definitions.

## Manage definitions in the app

Open **Library** in the header. It is shared across projects; returning to the project restores the selected project context.

- **Personas:** create or edit a name and Markdown instructions, duplicate a saved persona, inspect workflow/state references, and delete unused personas. The stable ID is the filename under `config/personas/`. Referenced personas must be reassigned in Workflows before deletion.
- **Workflows:** create a conversation-to-final graph or duplicate an existing workflow. Set the initial state, add states, assign personas/executors, and configure each event's target, artifact outputs, guard, clear list and saved-resume behavior. State settings include input artifacts, parallelism and retry limits. The preview shows the graph and an explicit event/target list.

Saving validates the same schema used by the runner, checks referenced persona files and atomically replaces `config/workflows.json`. Invalid targets, unreachable states, missing final routes and invalid executor combinations leave the saved files unchanged. Revision checks reject stale edits and preserve the editor draft for review or reload. Workflow revisions cover the shared file, so an edit to another workflow can also require reloading.

Personas and workflows keep stable IDs on edit; duplication creates a new ID. Deleting a workflow removes it from future task choices. Existing tasks continue from their saved graph and persona contents even when their Library definition is edited or removed. Library writes take effect without restarting the runner. Use `BARRACKS_PERSONAS_PATH` and `BARRACKS_WORKFLOWS_PATH` for isolated configuration copies.

Native ticket executors emit the events listed above. Configure handoffs for those events; the editor exposes the existing capabilities and does not create new executor implementations. Parallelism limits concurrent tasks using a given workflow/state; each individual task follows one current state.

## Verify changes in the Library

```powershell
npm run build
npm run test:library
```

This harness exercises isolated Persona and Workflow CRUD, stale-save handling, graph rejection, new-task choices, narrow-screen layout and persistence across restart. Local graph tests additionally change and delete Library definitions while a task is paused, then resume the task from its pinned snapshot.

## Verify runner changes

```powershell
npm run check
npm test
npm run build
npm run test:projects
npm run test:real
```

`test/state-machine.test.ts` changes discovery and delivery state names, initial personas, routing, role bindings and human handoffs using JSON fixtures. It checks graph/persona snapshot pinning, guards and bounded invalid-output handling. `test:real` uses actual Codex workers in an isolated project. Raw receipts and task artifacts stay under ignored `.state`.
