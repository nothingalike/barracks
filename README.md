# Barracks

Barracks is a local software factory built around a persisted state machine. Configured coding workers perform assignments; the runner validates their results and advances work through the workflow. The dashboard shows progress and provides intervention controls.

## Current work

The application has a Vite/React dashboard, a local Node/TypeScript runner and SQLite persistence. Select a project in the header, then create a task by choosing a predefined real workflow, entering a title and describing the goal. Project selection applies to tasks, tickets and creation. Saltwake intake is not enabled.

Open **Library** in the header to manage shared **Personas** and **Workflows**. Persona instructions and workflow states/handoffs are editable in the app. Saves update the canonical configuration files; new tasks use the saved definitions and existing tasks retain their snapshots. Referenced personas must be reassigned before deletion.

**Product discovery / grilling** develops and challenges the brief, then produces a specification and tracer-bullet ticket plan. You review the specification and test seams, then the ticket breakdown and blocking dependencies, before publication to PMT. Each review offers approval or requested changes; unresolved questions return to the persona that asked them. **Epic delivery** starts separately and routes each dependency-ready ticket through Lead, mandatory BA readiness, Builder implementation/TDD and independent Standards/Spec review. The assembled source then passes candidate-bound acceptance and a retrospective. Acceptance defects return through implementation and review. [Workflow configuration](docs/workflow-configuration.md) defines the handoffs and evidence contracts; [glossary](GLOSSARY.md) distinguishes workflow tasks from tickets.

Real-task testing covers refinement, implementation, independent review and fixes. Owned Windows process jobs gate cancellation and interrupted recovery; a stale review cannot complete a changed source candidate.

Agent assignments run without a fixed deadline by default. Optional state deadlines, bounded verification commands, inactivity warnings and repeated-failure escalation provide supervision. Inactivity leaves the agent running; cancellation and interruption retain files and require confirmed process cleanup before replacement. See [assignment supervision](docs/workflow-configuration.md#assignment-supervision).

## Repository layout

| Path | Purpose |
|---|---|
| docs/current-direction.md | Current scope and adopted policies |
| docs/workflow.md | State transitions, capacity and recovery contract |
| config/workflow.json | State parallelism and retry budgets |
| config/workflows.json | State-machine graphs: initial state, personas, events, handoffs, artifacts and limits |
| config/projects.json, config/personas/ | Local projects, verification commands and worker instructions |
| docs/testing.md | Dashboard instructions and repeatable real tests |
| server/, shared/, web/, test/ | Runner, contracts, dashboard and verification |
| project/ | Canonical PMT stories and planning history; reassess existing items before assignment |
| .workspace/pm-toolbox.yml | PMT workspace configuration |
| archive/ | Superseded Factory starter, standalone proof and runtime experiments |

## Run

Use Node 22.23.3 (recorded in `.node-version`) or a compatible newer version:

```powershell
npm install
npm run build
npm start
```

Open <http://127.0.0.1:4111>. Select or add your local project, click **New task**, choose **Product discovery / grilling**, and describe what you want. Review/edit outputs in **Tickets**, then start **Epic delivery** for the chosen epic when ready. There is no execution-mode or project field in the task form. [Testing guide](docs/testing.md) explains setup and controls.

For development, `npm run dev` starts the runner on 4111 and Vite on 5174. Stop your existing Barracks process first so only one runner owns the database. The runner continues when you close the browser. Reboot persistence is not configured.

`npm test` checks real SQLite transitions, concurrency, review identity/revision, pause, cancellation and interrupted recovery. `npm run check` typechecks the application. Local state is ignored under `.state/`.

Use **Library → Workflows** to change graph-state parallelism for future tasks, with no runner restart. The older direct-ticket substrate reads `config/workflow.json` at startup. Capacities default to one; Builder and Reviewer capacities are independent. See [workflow configuration](docs/workflow-configuration.md). Earlier application commands belong to the [archived approaches](archive/2026-10-22/README.md).

## Real-worker qualification

`npm run test:browser` checks project scope, the workflow form, user answers and ticket editing. `npm run test:projects` runs those cases plus registration/settings against an isolated configuration/database. `npm run test:real` uses real Codex personas and headless Edge for discovery, ticket review/editing and two-ticket epic delivery. `npm run test:recovery` exercises the delivery-worker recovery substrate, and `npm run test:new-project` qualifies first-code creation from empty source. Real qualification commands invoke authenticated Codex. Simulated workers remain internal test fixtures; the product accepts real workflow execution only.

`npm run test:library` uses isolated configuration copies, SQLite and headless Edge to check Persona/Workflow editing, validation, conflicts, mobile layout and persistence across a runner restart. Run `npm run build` first.

The original bounded four-session proof remains [historical evidence](docs/codex-proof.md); its standalone adapter is archived. The current app uses the configured worker and owned-process backend. These local tests establish readiness to exercise Barracks, not certification of an unconfigured Saltwake toolchain or an authorization to integrate changes.

Project decisions, handoffs and reports live in ~/.headquarters/barracks. All work remains uncommitted.
