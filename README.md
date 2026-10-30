# Barracks

A small local agent workflow runner built with C#/.NET 10, Stateless, Spectre.Console and SQLite.

- `config/personas/`: nine preserved agent instruction files.
- `config/workflows/`: six workflow definitions, one JSON file per workflow.

The previous implementation is preserved on `main` at `0d91304fd83633bc79fe9c519c46b9d2ad58d373`.

The first runner executes `grilling` read-only through the installed Codex CLI. The other five workflows remain definitions for later delivery work. The previous web runner is preserved in the snapshot.

## Run grilling

Requirements: .NET 10 SDK and an authenticated native Codex executable. Barracks discovers Codex on PATH or in the local desktop installation. Use `--codex <path>` or `BARRACKS_CODEX` to choose another executable.

From PowerShell in this folder:

```powershell
.\barracks.ps1 validate
.\barracks.ps1 run --workflow grilling --project $PWD.Path --task "Explore how Barracks should display agent activity."
```

The terminal shows persona colors, the workflow, current state, allowed transitions, elapsed time and recent observed activity. At a human state, live rendering ends before questions and review controls appear. Choose an outcome, supply its payload fields, or choose **Leave waiting**. Long text and structured values can be supplied as `@path` to a UTF-8 text or JSON file. Recorded questions, answers and review decisions remain available across rounds.

Each run prints its ID. Use that ID with these commands:

```text
barracks.ps1 resume <RUN-ID>
barracks.ps1 show <RUN-ID>
barracks.ps1 show <RUN-ID> --json
barracks.ps1 signal <RUN-ID> --trigger answered --payload <JSON-FILE>
```

`signal` saves one human transition. `resume` continues execution. An answer payload file contains an object such as `{"answers":"Use SQLite and a terminal interface."}`. The current state's `outputs` determines the required keys. `show --json` emits machine-readable JSON. Use `--non-interactive` on run/resume to stop at human states without prompting.

SQLite at `.state/barracks.db` stores current context, state, status, workflow/persona snapshots and append-only activity/transition evidence. Use `--database` for a separate file. Raw Codex events, stderr, prompts, schemas and final replies are retained under `.state/attempts/`. Both locations contain potentially sensitive project content and are Git-ignored. Personas and workflows remain editable source files under `config/`.

One local process owns a run at a time. Invalid replies fail without applying their payload or advancing the state. Ctrl+C during agent work terminates the owned worker tree and saves an interrupted run. Explicit `resume` retries the current read-only state. Barracks adds no automatic retry, agent time limit or exchange budget. Closing a terminal abruptly or killing the host is not qualified for worker cleanup; background hosting and automatic crash recovery remain deferred.

```powershell
dotnet test Barracks.slnx
```

## Workflow contract

`schemaVersion: 3` identifies this revised format. Each workflow declares its launch `inputs` and `initial` state. States have one of three types:

- `agent`: apply the named persona plus the state's instructions to its supplied inputs.
- `human`: wait for the user to emit an allowed trigger with its payload.
- `final`: finish with the listed inputs and display its message.

`inputs` names required context values. `optionalInputs` names values supplied when present. Persona instructions define the reusable role; state instructions define the current assignment.

Every `on` key is an allowed trigger. Its `target` is a literal state name. Its `outputs` lists the fields required in that trigger's payload. For example, `develop_brief` in `grilling.json` accepts:

```json
{
  "trigger": "brief_ready",
  "payload": {
    "brief": "A local task list with projects and due dates."
  }
}
```

Barracks looks up `brief_ready` in the current state's `on` map and moves to `challenge`. The agent supplies the outcome and payload; Barracks chooses the configured destination.

The runner validates the current assignment, trigger and declared payload fields before changing context or state. It accepts exactly the declared output keys, requires nonempty values, clears the transition's `clear` keys, then stores its outputs and destination together with a transition event. Rejected replies preserve context and state and mark the attempt failed. An output declaration checks the presence of an artifact; its correctness requires the configured review or acceptance stage.

Each question has an explicit human state and return target. For example, `develop_brief` emits `needs_user` with `questions`, and `await_develop_brief` accepts `answered` with `answers` before returning to `develop_brief`. Human review states use `approved` and `changes`; an answer alone does not grant approval.

`clear` removes artifacts that a revision invalidates. A new brief clears downstream specifications and approvals. A new candidate clears earlier review and acceptance results. Store execution history separately from the current context so revisions preserve their audit trail.

## Starting scope

All six definitions are standalone. Delivery runs one ticket at a time through Lead assessment, BA readiness, Builder implementation and independent review. The qualified variants add a separate Spec review before Standards review. Lead ticket acceptance records evidence; integration and external ticket status changes remain separate operations.

The `parallel-delivery` ID is retained for continuity, but its current graph is sequential. Parallel scheduling, child workflows and worktree automation are deferred. Agents receive configured branch and workspace authority through `project`.

Integration and publication are explicit human checkpoints. They confirm an operation already performed with the user's available tools, including its actual source identity or published references. An agent response does not apply a Git merge, publish PMT tickets, copy source files or update external ticket status.

Legacy workflow kinds, executor selectors, role aliases, concurrency settings, automatic-exchange budgets, retry policy, named guards and hidden resume targets have been removed. Timeouts, recovery and automated operations remain future runner design decisions. Start by exercising `grilling.json` through questions, revisions and approval before adding delivery automation.
