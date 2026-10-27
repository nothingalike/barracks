---
schema_version: 4
type: story
id: BRK-029
epic: BRK-E12
title: Rehearse and stage a fenced whole-team Saltwake transfer
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-028"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-24
updated_at: 2026-10-24
---

# Rehearse and stage a fenced whole-team Saltwake transfer

## Summary

Prove the complete disposable workflow and actual Rust execution, then support fresh paused manifest validation, dirty work/review/process preservation, exclusive coordinator fencing and effect-aware rollback. Live transfer remains a final approval.

## Acceptance Criteria

- Run whole-team disposable orchestration with long builds, review rejection, shared-interface waits, conflicts, missing platform evidence and recovery.
- Qualify relevant actual Rust/Bevy native/Wasm commands separately from controlled-worker tests.
- Validate a fresh paused transfer manifest including dirty/untracked work, participants, scoped reviews, artifacts, processes and pending actions.
- Prove one coordinator owns writes and rollback reconciles external effects; live transfer remains a concrete final approval.

## References

- [Target workflow and qualification plan](../../../../docs/saltwake-delivery.md)
- [Operational readiness assessment](http://localhost:4321/f/barracks/general/reports/2026-10-24-1845-saltwake-readiness)

## Questions

- No remaining questions.

## Plan

Follow package 6 in [Saltwake delivery readiness](../../../../docs/saltwake-delivery.md). Review against frozen pre-change source `.state/saltwake-before`; no committed HEAD exists.

Implemented and qualified within the boundaries below.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |

## Current implementation evidence

Readiness is built and independently reviewed. Full release regression112/112 and browser23/23 pass. Actual four-role Codex delivery and retained-work resumption both passed; transferred proof: `.state/saltwake-team-transfer-proof/e80ca3e5-1cb6-4831-925a-7fd81d8c98dc/result.json`. The old-team checkpoint is simulated there; resumed workers and native/Wasm jobs are real.

Sealed adoption now rechecks actual effects/process evidence while Source/tracker authority is held. Explicit original Builder ownership distinguishes review handoffs. Durable claims bind the initial parent/child lineage; consumed progress is not reimported into reopened delivery. Tests cover stale approval, ownership ambiguity, retained committed/dirty/deleted source, imported conflicts, checkpoint replay, reopened current-source fixes and committed-link rejection. Prior review pins remain context for fresh current-candidate verification.

Saltwake011f8a5 disposable native/Wasm builds,285 domain tests, strict Wasm clippy and packaged profile commands passed. A bounded standalone owned SwiftShader Chromium observer passed; the automatic sandboxed browser path remains unqualified. No physical controls/GPU/performance or live deployment qualification is claimed.

Preliminary role-explicit transfer `.state/transfers/a402d89e-f120-4a12-8a2e-c3cf979c9eef` retains four role contexts, canonical records and six T11 dirty files. Its proposed profile is absent from live settings; no activation approval/fence exists. The current Saltwake team remains active under its Lead. Final checkpoint, exact owned-job/cache reconciliation, fresh manifest and activation approval are still required.

Story status is retained for user review; BRK-E11 stays deferred. Review: http://localhost:4321/f/barracks/general/reviews/2026-10-24-2238-qualified-saltwake-delivery

## Completed-batch checkpoint, 2026-10-25

The user-selected batch is complete. Read-only evidence: `.state/saltwake-handover-20261025/verification.json`; fresh sealed checkpoint: `.state/transfers/3731b0e2-bce6-4e95-999b-d32cddd33481/manifest.json`. Integration62703e6, clean worktrees, canonical SW199/SW355 completion and435 integrated test/log/review hashes verified. The old coordinator has no background goal; activation schema now represents that honestly, covered by the focused transfer regression. Profile verification matches the accepted full-workspace/all-feature native/Wasm contract. Final activation remains pending; no live Saltwake profile, assignments or source changes were made.


## Live trial recovery, 2026-10-25

Saltwake was activated under the explicit one-ticket SW-352 authorization after the old batch completed and its team was fenced. Parent9d9189e1, childf47e5bf5: Builder, independent Spec/Standards and Lead combined integration passed. Two real trial gaps were reproduced and fixed: resolved child workflows now notify an explicitly configured parent wait, and acceptance receives exact-candidate source review receipts from completed independent assignments plus the Lead review. Real product/recovery/cancel/approval gates remain. Existing baseline source observations/adjudications/waivers are preserved.

Evidence: 114 full-suite regressions; final five evidence-ledger cases and end-to-end resumed-child/source-evidence replay passed; TypeScript passed. Spec and Standards independently found the baseline-only compatibility edge, fixed and rechecked with no remaining actionable findings. Owned runner restarted94272→26512 with backups; all11 accepted todo-app hashes preserved, game/user servers untouched. Live acceptance resumed with four source receipts. The Saltwake ticket stays in-progress until final acceptance and reviewed-branch Source publication. Barracks code remains uncommitted. Review: http://localhost:4321/f/barracks/stories/BRK-029/reviews/2026-10-25-2207-routine-delivery-recovery


### Acceptance citation handoff follow-up

The next live attempt passed all six verification commands but its model response omitted command/unit citations for criteria1–3. Reproduction proved acceptance_requirements was absent from the model handoff despite validation requiring it. The runner now supplies the exact plan and explicit per-criterion receipt coverage rules. New acceptance states use one configured invalid_output correction with acceptance_output_feedback; the existing event filter keeps that event runner-owned.

Evidence: .state/acceptance-citation-final-tests.log reports14/14 focused cases; TypeScript passed; Spec/Standards review passed. Tests preserve rejection of omitted citations, stale/forged evidence, invented waivers and model-selected retry events. Owned runner26512→90660 restarted idle with backups and11 accepted todo-app hashes preserved. Existing live graph stayed frozen; operator resumed acceptance with the corrected prompt. Final acceptance/Source delivery is pending. http://localhost:4321/f/barracks/stories/BRK-029/reviews/2026-10-25-2207-routine-delivery-recovery


### One-ticket trial complete

Canonical SW-352 COMPLETE; parent9d9189e1-5829-4735-800d-19c0908947c7 COMPLETE. Candidate0a2b0c5 passed both independent axes, Lead integration, all4 acceptance criteria, 435 workspace tests, fmt/strict native+Wasm checks and both builds. Exact seven-test-path reviewed branch fast-forwarded into Saltwake-rust rust-refactor at a2ed2b8b184b290fe0504fc4cdf2734c8d3cd561. Source match/acceptance/publication verified. Main73538aa, PR530 and external preview untouched; no second ticket started.

The pre-publication Windows regression exposed raw snapshot EOL changes in unchanged Source blobs and LF/CRLF publication checks. Fixed through Source clean filters in the alternate index, literal pathspecs, preserved candidate modes, and reviewed-branch-only content matching for publication/UI. Final16 Source/publication/acceptance tests, TypeScript and Spec/Standards rechecks passed. Owned runner81504; backups retained. The trial is supervised proof: BA discovery and final Lead integration used the trusted operator. Retrospective follow-ups remain proposals, not new Saltwake assignments. http://localhost:4321/f/barracks/stories/BRK-029/reviews/2026-10-25-2207-routine-delivery-recovery
