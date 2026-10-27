# Parallel epic delivery

Choose **Deliver epic** to use `parallel-delivery`. Set the ticket concurrency to 1–8; the default is two. The installed worker pool allows two assignments each in refinement, implementation and review. The ticket limit bounds active ticket teams; worker capacities can further limit simultaneous assignments. The sequential `delivery` workflow remains available, and existing runs retain their pinned definitions.

For example, with independent tickets A and B and ticket C depending on both:

```text
A: Lead → BA → Builder → independent Reviewer ─┐
                                             ├→ Lead integration → C team
B: Lead → BA → Builder → independent Reviewer ─┘
→ Lead integration → final acceptance → retrospective → project publication
```

The parent dispatches bounded batches. It waits for every ticket in the batch, integrates the approved changes, then selects the next dependency-ready batch. This provides predictable integration boundaries; it is not a scheduler that immediately fills every freed slot. Dependencies within the epic require parent integration, even when PMT already shows a ticket as reviewed.

## Source ownership

The selected project folder must be a repository or Git worktree root. At launch, the parallel workflow captures its current files, including uncommitted files that Git includes in its tracked/unignored inventory. It excludes Git, runner, dependency and configured PMT project metadata. This differs from the legacy sequential workflow's committed-ref clone. The selected folder is the baseline; its configured ref does not replace current working-tree content in parallel delivery.

Each ticket uses a real detached Git worktree sharing a runner-owned private object store. Private synthetic commit anchors support branching and merging even when the selected source repository has no first commit. These anchors live under `.state/tasks`; the associated repository's commits, branches and index are not changed.

Each configured ticket team refines, builds, verifies and independently reviews its own candidate. The Lead inspects the combined candidate and independent verification receipts. Verification accumulates across batches, including meaningful commands established by Builders when project settings provide none.

Merge conflicts, requested integration changes and final acceptance defects return to the configured ticket team with the combined scope and retained findings. Repair receives conflict markers when available. Its result passes independent review and Lead integration again. Durable reservations and integration checkpoints make recovery replay safe; cancellation drains owned work before releasing assignments.

## Publication and completion

After final acceptance and retrospective, publication applies the accepted delta to the associated folder as uncommitted files. It checks the initial source hashes, exact accepted candidate and final target hashes. Existing user changes hold publication for resolution; untouched managed files are checked too. Unrelated files and PMT metadata remain in place. A detected failure rolls back files written by that publication when their content still belongs to the runner, preserving concurrent user edits.

The parent reaches Complete only after publication succeeds. Ticket review completion and parent integration remain separate stages on the board. One unfinished parallel parent owns publication for a project at a time. Filesystem copying cannot lock out arbitrary external editors: avoid editing managed source during final publication; detected drift holds the run.

## Qualification

`test/parallel-delivery.test.ts` exercises dependency gating, overlapping teams, conflict/acceptance repair, cancellation and restart/crash replay with controlled workers. `test/parallel-source.test.ts` uses real Git worktrees and checks merges, accumulated verification, safe publication, user edits and rollback during a publication race.

Run `node --experimental-strip-types scripts/parallel-real.ts` for a disposable native-worker proof. It requires overlapping actual assignments, three reviewed/integrated tickets including a dependent continuation, final acceptance, retrospective, publication into the original fixture folder, and no source commit. Evidence remains under `.state/parallel-real` and `.state/tasks`. This proof does not change the user's todo-app.
