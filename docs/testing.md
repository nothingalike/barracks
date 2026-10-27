# Real testing

Barracks can start real Codex tasks from the dashboard. The built-in slug project is a disposable fixture; local Git repositories can be configured separately. Saltwake is not configured for intake.

## Start the app

Use the installed Node version recorded in `.node-version`:

```powershell
cd C:\Users\johns\source\repos\barracks
$env:Path = "$env:APPDATA\nvm\v22.23.3;$env:Path"
npm run build
npm start
```

Open <http://127.0.0.1:4111>. The runner continues when the browser closes. Restarting the runner holds interrupted attempts for reconciliation. Reboot/service installation is outside this version.

## Run a task yourself

1. Select or add your local project using the header selector. The selected project scopes the workspace and every new task.
2. Click **New task**, choose **Product discovery / grilling**, and enter a title and product brief. There is no project or execution-mode field.
3. Follow the Product Owner/Architect exchange. Answer only the unresolved decisions presented in the task; the Architect then specifies and the Project Manager prepares PMT tickets.
4. Open **Tickets** for the live status board. Select an epic or ticket to open its details drawer, then choose **Edit details** to revise scope/acceptance criteria. Save edits before starting delivery. Active delivery locks editing; unsaved drafts survive board refreshes.
5. Choose **Deliver epic** or create an **Epic delivery** task and select the epic. The Lead takes its tickets through BA, Builder and independent review. Expand child tickets for source paths, progress and worker logs.
6. The final ticket workspace contains the cumulative approved source. Integration is a separate authorized action.

Each task uses its own local copy under ignored `.state/tasks/<task-id>/`. The fixture's protected README and original tests must stay unchanged. Worker authentication remains with the installed native Codex CLI; no account or remote repository connection is required in Barracks.

The header project selector scopes workflow tasks, tickets and activity counts. Selection persists in the URL and browser storage; browser Back restores the previous project. New tasks inherit it automatically. **Pause workflows** applies across projects. Existing direct-execution qualification records remain in the database; the Tasks view shows named workflow runs.

## Pause, cancel and reconcile

- **Pause workflows** stops new dispatch while running work can finish.
- **Cancel workflow** drains its owned persona work and unfinished child execution. It preserves source, PMT artifacts and history.
- On interruption, the workflow waits for reconciliation. Provide a resolution note and select **Continue workflow**. The runner verifies process cleanup first. A changed reviewed source returns to implementation and verification rather than accepting a stale verdict.
- Technical blockers can be routed to the Lead within `maxTechnicalResolutions`; product/authority questions, recovery holds and exhausted resolution budgets need operator input.

Review/fix findings and operator resolutions are persisted and supplied to the next assignment. Builders implement; Reviewers review. Codex internal subagent delegation is disabled so the runner owns assignment and capacity.

The run's **Code and delivery** section shows generated source files, the build workspace, the associated project folder and final acceptance separately. A Complete ticket has passed ticket review; this alone establishes neither epic acceptance nor return of source to the project folder. Output matching is checked against the reviewed candidate and reports changed/unavailable workspaces without hiding run history. Source return remains an explicit authorized handoff; the todo-app qualification copied accepted files as uncommitted additions, then reran tests and build from the project folder.

Final acceptance uses the same isolated candidate/baseline Git evidence as ticket review and receives actual command exit codes and output before its verdict. Retrospective and recovery assignments explicitly identify retained evidence and do not claim fresh checks that were not run for that assignment.

Before the Reviewer model starts, the runner makes a separate source snapshot with its own Git objects and index, reruns the fixed verification plan with each command's configured permissions, and supplies candidate-bound receipts plus the predecessor diff. `.git/barracks-review.json` and `.git/barracks-baseline.diff` in that snapshot hold the evidence; candidate and baseline IDs are trees, so an unborn `HEAD` is valid. The model inspects source read-only. Missing evidence or unavailable tooling is a technical blocker, while actionable source/acceptance defects request Builder changes. Verification failures and source changes prevent approval.

`maxRepeatedReviewFindings` also bounds consecutive rejections of the same candidate, even when the findings are reworded. A new candidate resets the unchanged-candidate count; a Lead resolution resets the intervention counters. Changing prose alone is not implementation progress. `test/review-evidence.test.ts` checks the actual worker handoff order, evidence availability, failure routing and source guards using a process double; native worker proofs establish the sandbox/model boundary separately.

## Repeatable commands

```powershell
npm test
npm run build
npm run test:browser
npm run test:real
npm run test:recovery
```

`test:browser` checks the dashboard on 4111 with isolated headless Edge profiles and browser response fixtures. It covers project scope, search/keyboard/Back, inherited task context, workflow selection, decision answers, ticket editing and mobile layout. It invokes no real model and offers no simulation mode in the product.

`test:real` starts an owned server on 4125 with separate configuration/database and an empty Git project. Headless Edge starts real persona discovery, reviews/edits the resulting PMT tickets and explicitly starts epic delivery. Two dependent tickets must each pass BA, Builder and Reviewer, with cumulative approved source and PMT completion. `qualify:codex` aliases this test. It invokes authenticated Codex and can take several minutes.

`test:recovery` starts another owned test server on 4122. It seeds a controlled technical blocker for a real Lead resolution, cancels a real writing worker, kills its own server while another worker writes, verifies the restart hold, explicitly reconciles, injects a stale-source change during real review, and requires fresh verification/approval to finish. Source and process evidence are retained.

The isolated tests never terminate the normal app or another user process. They verify server-instance identity before using the test port. If a test port is occupied, the test fails instead of taking over the other service. Test-server databases and logs live under `.state/real-tests/`; per-task source, attempts and process receipts remain under `.state/tasks/`.

## Configure another local project

Open the project selector and choose **Add Project**. Click **Choose folder** to navigate the normal Windows folder dialog and select the project folder. You can also paste a local path and click **Use this folder**. Barracks checks the folder and offers any missing Git setup before opening project details.

If Git is missing from the folder, choose **Initialize Git** or **Not now**. Initialization creates a local repository on main. If the repository has no commits, a separate **Create first commit** prompt lets you select files and confirm an author name/email. Git-ignored files stay excluded, and an empty folder can receive an empty initial commit. Only previously staged files start selected; the prompt requires those files to be included or their staging adjusted in Git. The author identity applies to this commit only. No Git action happens just from selecting or inspecting a folder. Existing committed repositories proceed directly to project settings.

Confirm the name, enter project instructions, keep or edit the review criteria, and save. For a brand-new project, leave **Build and test** and **Protected files** empty: existing source files and commands are optional at registration. Normal registration preserves source and history; Git initialization and the first commit run only when you explicitly select their actions. If the selected folder belongs to a parent repository, choose that repository's root instead.

Select a project and open **Project Settings** from the selector to edit its name, folder, source branch/ref, verification commands, instructions, review criteria and protected files. Project IDs stay fixed to preserve task history. Save is held while the project has unfinished real tasks; finish or cancel them before changing its settings. Changes take effect without restarting the runner.

For npm projects, setup suggests existing build/test scripts without running them. Confirm these commands and arrange dependencies/toolchain access in the task copy before real work. Expand **Edit command** to change the executable, argument array or build-artifact access. Configured commands are optional for a new project. Named workflows are defined in `config/workflows.json`; role instructions live separately in `config/personas`.

When a project has no configured commands, its first Builder establishes meaningful verification commands alongside the implementation/tests. The runner validates and saves that task's plan outside its source copy as `verification.json`, runs it independently, and gives the same fixed plan to the Reviewer. Later Builder fixes reuse the plan. An empty or malformed plan cannot pass a build or review. These task-specific commands do not overwrite the project's settings.

Run `npm run test:new-project` to qualify actual creation from an empty committed folder: an isolated server on 4124 registers the project without files/commands, runs real Codex Lead/Builder/Reviewer work, records independent verification and requires completion while preserving the empty source. Evidence stays under `.state/new-project-real` and `.state/tasks`.

Settings are persisted atomically to `config/projects.json`. Each project has an ID/name, a `kind` (`fixture` or `repository`), source `path`, optional Git `ref` (default HEAD), protected file paths, verification argument arrays, instructions and review criteria. The native Codex executable, nullable default assignment deadline and inactivity-warning threshold remain server-side settings. Assignments default to no deadline; workflow states can override it through the Library. See [assignment supervision](workflow-configuration.md#assignment-supervision).

Run `npm run test:projects` for project registration/settings qualification. It starts an owned server on 4123 with a separate database and project configuration and runs twelve UI cases. Tests cover declined Git setup, missing confirmation, initialization, selected/ignored files, an empty first commit, settings persistence across restart and preservation of the original committed fixture's bytes/HEAD. Git actions affect disposable intake fixtures only. Browser tests simulate the native picker response to check selection, cancel and failure while using real inspection/save endpoints. `npm test` compiles/configures the native Explorer dialog without showing it. Interactive native selection needs a manual check in the Windows session. These tests invoke no real model workers and leave the normal configuration unchanged.

For legacy sequential repository delivery, Barracks clones the committed source into an independent task workspace using separate Git metadata and no hardlinks, checks out the requested revision detached, and removes the origin remote. That path does not copy uncommitted source changes. [Parallel epic delivery](parallel-delivery.md) captures the selected working tree, uses managed Git worktrees, then publishes accepted changes back as uncommitted files. Current workspaces reject symlinks.

Verification commands default to the read-only Windows sandbox. A configured `sandbox: "workspace-write"` permits build/test artifacts within the task copy; existing source files must remain unchanged by verification. `node` selects the copied Node executable; other configured commands must resolve to a native `.exe`. Toolchain access and writable build caches need project-specific qualification. A verification command is never assembled as a shell string.

Edit `config/personas/*.md` for role instructions, and `config/workflow.json` for state parallelism and retry budgets. Omitted capacities default to one; the task's execution state determines which capacity is reserved. A visual workflow designer is deferred.
