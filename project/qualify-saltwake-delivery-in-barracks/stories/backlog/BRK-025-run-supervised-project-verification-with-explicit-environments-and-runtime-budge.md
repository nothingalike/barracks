---
schema_version: 4
type: story
id: BRK-025
epic: BRK-E12
title: Run supervised project verification with explicit environments and runtime budgets
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: []
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Run supervised project verification with explicit environments and runtime budgets

## Summary

Replace fixed verification limits with per-command budgets and explicit environment, retain owned process cancellation/recovery, and qualify real disposable Rust native/Wasm commands without touching Saltwake.

## Acceptance Criteria

- Use one command execution policy for Builder, Reviewer, integration and acceptance.
- Support explicit environment and per-command bounded or unlimited runtime while retaining owned-process cancellation/drain/recovery.
- Keep generated caches outside source candidates; preserve tracked-directory link guards.
- Prove an actual command lasting over sixty seconds, actual native Rust tests and actual Wasm compilation in disposable sandboxes.

## References

- [Target workflow and qualification plan](../../../../docs/saltwake-delivery.md)
- [Operational readiness assessment](http://localhost:4321/f/barracks/general/reports/2026-10-24-1845-saltwake-readiness)

## Questions

- No remaining questions.

## Plan

Follow package 2 in [Saltwake delivery readiness](../../../../docs/saltwake-delivery.md). Review against frozen pre-change source `.state/saltwake-before`; no committed HEAD exists.

Unified project-command.ts policy is wired through workers and delivery inspection. Native proof .state/rust-command-proof/6de5eeb9-4c39-4801-ab72-ffb6377f530d/result.json passed: owned command68504ms, actual dependency-free Rust test and Wasm build, unchanged source. Bevy/platform qualification remains BRK029. Existing review/acceptance/project tests passed.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |

## Current implementation evidence

Implemented one owned-command policy with explicit bounded/unlimited budgets, case-insensitive environment and private hashed installed-tool copies. Actual 68.5-second job, native Rust test and Wasm library proof passed. Actual Saltwake integration011f8a5 native client and Wasm builds, native domain checks and strict Wasm clippy passed in a private archive. Trunk packaging passed with private wasm-bindgen; sandboxed Chromium remains unqualified and is not claimed as an automatic host capability.

See [implementation and proof boundaries](../../../../docs/saltwake-delivery.md). Story status remains unchanged for user review. BRK-E11 SQLite Library migration remains deferred.

Review: http://localhost:4321/f/barracks/general/reviews/2026-10-24-2238-qualified-saltwake-delivery
