# Barracks

Historical custom-runtime prototype. The application now runs from `factory/`; see the root README. Use `npm run check:prototype` and `npm run test:prototype` for the earlier code. The commands and qualification statuses below describe that earlier implementation.

A local software factory for a configured Lead, BA and two Builders. Mastra workflows coordinate CLI workers; project-specific configuration keeps Saltwake separate from other projects.

## Current slice

The qualification workflow discovers explicit local CLI entry points, invokes only version probes and persists its result through Mastra/libSQL. Typed contracts require exact source/evidence and next-action requests. Qualification configuration always disables live dispatch.

This is the foundation, not a running factory. Authenticated structured worker jobs, write isolation, dispatch/recovery, review/merge gates, controls and whole-team migration remain unqualified/unimplemented. No game worktree is changed by qualification.

## Run

Requires Node24.5 or newer. From this folder:

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run qualify
```

Results and workflow storage live under ignored `.barracks/`. CLI discovery checks the active Node installation's Codex package and the user's `.local/bin/claude.exe`. `BARRACKS_CODEX_ENTRY` and `BARRACKS_CLAUDE_PATH` may point to explicit installed entry paths. No credential files are inspected and no model job is invoked by the version probes.

The Saltwake example config is qualification-only: its integration branch is rust-refactor and main is protected. Other projects can choose different integration branches. These schema checks are not a claim that OS-level isolation is already implemented.

## Design

Shared architecture/cutover documents: Headquarters barracks/general/design/2026-10-22. Implementation progress: docs/implementation/runtime-qualification.md. This repository has no remote or commits yet; live migration requires the plan's qualification and exclusive-ownership gates.

## Qualify worker protocols

These opt-in commands invoke authenticated model requests using existing CLI logins:

```powershell
npm run qualify:protocol -- codex
npm run qualify:protocol -- claude
```

Each experiment creates a disposable temporary directory, requests a structured marker response, then resumes the captured session ID and checks recall. It closes stdin explicitly and bounds each call to 60 seconds and 1 MiB of captured output. Claude requests a $0.50 per-call cap; Codex has a time bound without a dollar cap. Evidence is retained under ignored `.barracks/protocol/` and the temporary fixtures remain available for inspection.

Codex uses read-only sandbox mode with approvals disabled and user configuration omitted for this fixture. Claude uses safe mode, no tools or MCP servers, and denies permission prompts. These qualification settings do not establish the production role/model configuration or enforced canonical repository protection. Timeout handling terminates the direct child; process-tree cancellation remains unqualified.

## Track delivery

The repo-local PMT workspace uses key `BRK`, stores items under `project/`, and has GitHub integration disabled. [Delivery order](docs/implementation/delivery-plan.md) maps the nine approved planning packages to epics. P01 has five qualification stories and P02 has its first ledger story. Remaining work requires bounded refinement before assignments. Stories remain backlog until an authorized status change.

The first P02 slice, BRK-006, adds the [transactional execution ledger](docs/implementation/execution-ledger.md). It persists assignments/results and deduplicated obligations, with capacity and pause controls. It launches no work.

[Windows qualification](docs/implementation/windows-qualification.md) records passing owned-process cancellation and host-loss cleanup, plus the remaining isolation and coordinator-recovery failures. `npm run qualify:process` reproduces the passing lifetime cases. `npm run qualify:isolation-control` currently exits 2 because sandbox setup fails before its permitted read. These commands use only disposable fixtures.
