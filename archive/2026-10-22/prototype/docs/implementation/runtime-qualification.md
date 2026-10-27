# Local runtime qualification

Status: first P01 slice implemented and locally verified. P01 remains open.

## Evidence

2026-10-22 local session (UTC report 2026-10-23T00:58:57Z):

- TypeScript check passed (`npm run check`).
- Seven focused tests passed (`npm test`), including real child exit/error, timeout and output bounds.
- `npm run qualify` completed Mastra run cea580e7-c755-4a4f-ad7e-3a2527f915db using local libSQL storage.
- Node v24.5.0, Codex CLI 0.162.1 and Claude Code 2.1.306 version probes passed.
- Result saved in ignored `.barracks/qualification.json`; local workflow storage is `.barracks/mastra.db`.
- Saltwake's original worktree was clean after correcting an initial dependency-install working-directory error. The newly created install files were moved to Barracks; the misplaced manifest is preserved under ignored `.barracks/setup-recovery/`.

## Boundaries

Version discovery does not prove authenticated model execution. The bounded probe is not the worker broker: it kills its direct child and does not qualify process-tree cancellation or orphan recovery. The four-role schema validates configuration and review handoff shape; it does not enforce filesystem protection or dispatch work. The workflow always accepts liveDispatch=false.

## Remaining P01 acceptance

Qualify authenticated structured worker execution and continuation; process-tree cancellation; OS-scoped writes and canonical main protection; interactive Windows user-session/storage behavior. Later packages implement the execution ledger, CLI broker, unattended dispatch, review/integration gates, adapters and controls. Whole-team transfer follows rehearsal and exclusive coordinator ownership.

## Takeover qualification, October 22

Reproduced `npm run check`, seven existing tests and the actual Mastra/libSQL workflow. Run `93515cb8-efc6-4172-9f16-627dd305c674` completed at `2026-10-23T01:08:03.319Z` with the same installed versions listed above.

Added three protocol parser/continuation tests, bringing the focused suite from seven to ten passing tests. They reject incomplete Codex events, provider failure envelopes, missing structured output and mismatched continuation identity or marker.

Authenticated disposable experiments passed for both installed providers:

| Provider | Initial + explicit resume | Local evidence |
|---|---|---|
| Codex 0.162.1 | PASS, exact session and marker retained | `.barracks/protocol/codex-1b537899-d985-4919-a5dc-00c5071b00d7/` |
| Claude Code 2.1.306 | PASS, exact session and marker retained | `.barracks/protocol/claude-be6bba30-e608-4d3f-bb2d-d96aa013c738/` |

Initial experiments exposed an open stdin stream and Claude's rejection of the generated JSON Schema dialect declaration. Closing stdin and passing the shared schema subset fixed those harness issues. Failed-run evidence remains separate from the passing runs. A process inventory matched the two earlier Codex fixture paths and found no surviving matching Codex descendants to stop.

These are small marker/schema experiments using existing CLI authentication. They prove the tested protocol path, not production worker handoff semantics, configured models/roles, actual sandbox escape resistance, process-tree cancellation, orphan recovery or Windows desktop/sleep behavior. P01 remains partial and live dispatch stays disabled. Canonical scope is in BRK-001 through BRK-005; the delivery graph is in [delivery-plan.md](delivery-plan.md).

Protocol references checked against installed help and official documentation:

- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode): JSONL events, schema output and explicit session resume.
- [Claude programmatic execution](https://code.claude.com/docs/en/headless): structured result envelopes and explicit session resume.

Installed CLI help is retained under `.barracks/protocol/`. Runtime paths may need access outside the restricted agent sandbox on this machine; the commands passed using the installed Node runtime.

## Continued implementation

The focused suite now has 19 passing tests. [Windows qualification](windows-qualification.md) records passing explicit owned-tree cancellation and host-loss cleanup, plus blocked sandbox startup and unqualified coordinator-loss behavior. [Execution ledger](execution-ledger.md) documents BRK-006's transactional assignment/result outbox, deduplication, persisted pause and exclusive SQLite ownership. P01 and P02 remain partial; live dispatch stays disabled.

## Reproduce

From the Barracks folder, run `npm ci --ignore-scripts`, `npm run check`, `npm test`, then `npm run qualify`. Qualification invokes version commands only. The Saltwake example is qualification-only and does not activate the current team.
