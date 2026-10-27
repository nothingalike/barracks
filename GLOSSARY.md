# Barracks

Barracks runs configured teams against a project's product and software work.

## Language

**Project**:
A named local source folder and its project instructions, review criteria and work records. The selected project defines the workspace context.

**Persona**:
Reusable instructions describing a participant's responsibilities and behavior. A persona participates only where a workflow assigns it.

**Workflow**:
A configured state machine defining its initial state, worker responsibilities, events, handoffs and completion gates.

**Task**:
One running instance of a selected workflow, holding its current state, goal, history, answers and artifacts within one project.
_Avoid_: Ticket when referring to the running workflow.

**Task runner**:
The coordinator that assigns workers and advances tasks according to their workflow, while enforcing execution and review rules.

**State**:
A position in a task's workflow that assigns work, waits for human input, performs a runner operation or finishes the task.

**Handoff**:
A configured transition triggered by an event, with explicit artifacts passed to the next state.

**Epic**:
A goal grouping related tickets in the project's PMT record. A delivery task targets one epic.

**Ticket**:
An editable PMT work item with scope, acceptance criteria and dependencies, produced by discovery or consumed by delivery.

**Grilling**:
A discovery workflow in which a Product Owner develops a brief, an Architect challenges and specifies it, and a Project Manager drafts vertical-slice tickets. The user resolves open decisions and reviews the specification/test seams and ticket breakdown before publication.

**Delivery**:
A workflow in which a Lead coordinates BA readiness, Builder implementation and independent review across an epic's tickets, followed by cumulative acceptance and a retrospective.

**Acceptance**:
Evidence for every assigned user-visible criterion on an exact source candidate. Passed, failed and unverified results remain distinct; changing the candidate invalidates its acceptance.

**Retrospective**:
A review of primary execution evidence that proposes improvements to the agent's environment. Proposals remain separate from adopted changes.
