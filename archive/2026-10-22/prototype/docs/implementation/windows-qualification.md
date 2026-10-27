# Windows qualification evidence

BRK-003 and BRK-004 remain partial. Live dispatch stays disabled.

## Owned process lifetime

The C# helper creates an unnamed Windows Job Object with kill-on-close enabled and breakaway flags absent. It creates the fixture root suspended, assigns it to that object, then resumes it. The PowerShell host retains the handle and records PID/start identities. It cancels the object by its owned handle, rather than selecting processes by executable name.

The disposable fixture starts a root, child and detached grandchild. Passing cases observed:

- Explicit cancellation terminated the three fixture Node processes and their console helpers; querying the object returned zero members.
- Abrupt host loss terminated all three identified fixture descendants through handle closure.
- An unrelated Node sentinel survived both cases.
- Representative dirty-patch and untracked-file bytes were preserved. Actual game worktrees were not part of this experiment.

Windows added two `conhost` processes in the explicit-cancellation case. The audit records their membership and start identities. An initial assertion that expected exactly three job members was corrected to verify every fixture process belongs to the job and every reported member exits.

Reproduce the passing cases:

```powershell
npm run qualify:process
```

Evidence from the final combined suite: `.barracks/process/2d6489d5-f246-4e84-aed8-4cc9bbfb38df/result.json`. Each suite run records its own directory.

## Coordinator recovery remains unqualified

Experiments that launched a separate host and then exited the coordinator did not establish a surviving, usable tree. Detached-host trials produced no ownership receipt. A later hidden-host trial produced a receipt but failed to produce the complete three-generation fixture after coordinator exit. These are observed startup/lifetime failures; the precise underlying console/job relationship is not established.

The failing diagnostic remains available separately:

```powershell
npm run qualify:process -- coordinator-exit
```

It is outside the passing cancellation test. A supervised user-session launcher and real coordinator/broker reconciliation still require qualification. The helper is a lifetime experiment, not the production broker or a filesystem sandbox. External process creation through mechanisms outside normal child inheritance also needs separate fencing.

## Write isolation is blocked before the positive control

The installed Codex sandbox requires an explicit permission profile. Its read-only positive-control command fails with `helper_unknown_error: setup refresh had errors` before reading the fixture sentinel. This demonstrates an unavailable test path, not a successful refusal of forbidden writes.

```powershell
npm run qualify:isolation-control
```

The command exits 2 and saves structured blocked evidence under `.barracks/isolation/`. Current evidence: `.barracks/isolation/52da4845-db54-444f-a129-21a31413db46/result.json`. It changes no sandbox configuration and does not restart user processes. The next step is to restore a usable installed sandbox and rerun that command, then exercise allowed writes and canonical/ref mutation refusals in disposable repositories.

Claude's official sandbox documentation states that native Windows commands run unsandboxed. Its tool permissions therefore do not establish this project's OS write boundary. A shared restricted launcher or another qualified isolation boundary is required before either provider receives canonical repository access.

References checked October 22, 2026:

- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject).
- [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox).
- [Claude sandbox scope](https://code.claude.com/docs/en/sandboxing).
