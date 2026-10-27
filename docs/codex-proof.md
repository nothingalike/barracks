# Disposable real-worker proof

BRK-010 exercises the existing Barracks `Runner`, `Store` and workflow transitions using a bounded native Codex worker adapter. It runs only against the checked-in three-file slug utility fixture, copied beneath ignored `.state/qualification/<run-id>/`.

This document preserves BRK-010 evidence. BRK-011 supersedes the standalone adapter with the configured dashboard worker and owned-process backend. Current commands and qualification scope are in [Real testing](testing.md); the old adapter/command are archived under `archive/2026-10-23/standalone-codex-proof/`. The root `qualify:codex` alias now runs the current real browser test.

## Original invocation

With Node 22.23.3 selected:

```powershell
npm run qualify:codex
```

At BRK-010 this command invoked the standalone four-session proof using CLI-owned authentication and the bundled native Codex 0.163.0. It now aliases the current real-browser qualification; see [Real testing](testing.md). The original worker and its BARRACKS_CODEX_PATH override remain archived as history.

At that checkpoint the ordinary dashboard was simulated and the proof used its own SQLite database. BRK-011 now supports real dashboard tasks and keeps repeatable qualification servers/databases separate.

## Recorded outcome

2026-10-22 local: run `5bf68078-0141-4d6a-a946-07de723793bd` passed in approximately two minutes. Task `f1fa2d43-7de6-4c10-a875-a9f52ac60c53` completed two review rounds with four distinct real Codex sessions: Builder, Reviewer rejection, Builder fix, Reviewer approval. The first candidate was `fba9fba522c2ed5bb056576d6da915034772abac`; the approved candidate was `a1773c6a6ce6b74973379a8a8386e2f9eaa00104`. The original three assertions passed after implementation; all four tests passed after the required regression was added.

Evidence is retained under `.state/qualification/5bf68078-0141-4d6a-a946-07de723793bd/`: `result.json`, the SQLite database, source workspace, review snapshots, per-attempt events/receipts/checks and `effective-permissions.json`. Effective turn-context metadata confirms workspace-write Builder sessions and read-only Reviewer sessions, all with approval policy never, using the CLI-selected `gpt-6.1-sol` model.

Earlier runs remain as failed evidence: the first failed to launch Node from its NVM path; three subsequent Builder attempts remained read-only until the Windows sandbox implementation was supplied explicitly. None of those runs is counted as a passing worker proof.

## Test contract

1. Create a fresh workspace from `test/fixtures/slug-repo` and a separate Git object directory. Record an expected failing baseline by executing the fixture checks in the read-only Windows sandbox.
2. Use deterministic Lead routing for the fully specified fixture; BA refinement is skipped.
3. Start a fresh real Builder session with workspace-write access. Its first assignment changes only `slug.mjs`.
4. Independently run the fixture tests through `codex sandbox -P :read-only`. Capture the actual Git source tree rather than trusting the Builder's verification claim.
5. Copy that candidate into a separate review directory. Start a fresh real Reviewer session with read-only access. The Reviewer checks behavior and requires the deliberately missing edge-case regression test.
6. Route the finding through the persisted state machine to another Builder session. Permit the implementation and the new regression test file; preserve the original checks and README.
7. Run verification again, capture the revised tree and obtain independent approval in a fourth fresh Codex session. Assert two review rounds, four distinct sessions and a changed candidate tree.

The coverage requirement is intentionally staged to prove a review/fix handoff. It measures workflow execution, not the model's ability to discover an unexpected bug.

## Permissions and evidence

The adapter uses explicit `--sandbox` and `windows.sandbox="elevated"` settings with approvals set to never. Ignoring user configuration also omits the installed Windows sandbox selection; failing to provide it caused actual exec sessions to fall back to read-only, confirmed from their turn-context metadata. The corrected invocation retains the installed sandbox implementation without editing machine settings.

Node from the NVM profile path could not launch inside the sandbox. The proof copies the same `node.exe` into its ignored local tools directory; verification stays sandboxed. Generated source and tests are executed in the read-only sandbox rather than by the unrestricted host.

Each attempt retains its prompt, structured reply, JSONL events, PID/start timestamp, exit receipt, session ID and verification output. Raw provider diagnostics remain ignored locally. The proof summary contains the task history and candidate source identities. A candidate is a real Git tree hash, not a commit; no application or production commits are created.

The experiment limits each attempt to 180 seconds, output to 4 MB, the run to 15 minutes and unsuccessful review rounds to three. Those are experiment bounds, not adopted defaults for the ordinary workflow.

## Qualification boundary

This proof establishes only what the recorded run demonstrates. It does not authorize Saltwake intake or qualify production filesystem isolation, process-tree cancellation, orphan recovery, automatic restart, real BA/Lead reasoning, Claude workers, remote publishing or multi-task CLI capacity. The adapter's timeout/cancel cleanup is a best-effort owned process-tree termination and requires inspection before any retry after uncertainty.

Official invocation reference: [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive). Windows behavior: [Windows sandbox](https://developers.openai.com/codex/windows).
