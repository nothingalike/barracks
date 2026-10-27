# Saltwake delivery readiness

The user authorized preparing Barracks to take over Saltwake development on 2026-10-24. This authorizes Barracks implementation and disposable qualification. The current Saltwake coordinator, worktrees, source, canonical tracker and publication remain under their existing ownership until a separately approved transfer.

## Target workflow

```text
approved delivery frontier
  → ready ticket → implementation → independent review → Lead integration
        ↳ BA clarification when scope is missing
        ↳ project Lead decision when a shared interface needs resolution
        ↳ fixes return to implementation and affected review
  → required acceptance evidence → controlled delivery
```

Readiness is a concrete scope/base/dependency decision rather than a label. Original outcomes, child capabilities and delivery progress remain separate. A persistence capability can require real file failure/retry/reopen checks without a graphical gate. A visible combat change requires the relevant native/browser observations. Missing observations remain unverified; an explicit waiver or bounded adjudication retains the underlying measurement and its scope.

One project integration authority owns shared interfaces and integration. Personas describe responsibilities; participant/worker capacity is configured separately. The initial Saltwake rehearsal binds one Lead, one BA and two implementation/review participants, with independent authorship checks. The design can evolve from that starting point; it does not silently multiply the team per ticket.

## Implementation packages

1. **Project roots and delivery scope:** source and tracker paths are explicit. Project settings retain compatibility when the tracker is colocated. Intake can inspect a selected delivery frontier without writes, excludes rollups/external work, reports dependency blockers and source/tracker identity, and never initializes a replacement tracker. Pin the selected frontier into the run.
2. **Owned project commands:** verification commands support a deliberate runtime budget, explicit environment and workspace-relative build resources. Use the existing durable Windows process-tree ownership/cancel/reconciliation module. A long-running build is complete only when its actual process exits and all descendants drain. Qualify the actual Rust toolchain, native/Wasm build and sandbox access in disposable repositories.
3. **Ownership and decisions:** persist participant, file/resource reservations and scoped shared-interface requests. Routine engineering decisions schedule the project Lead automatically. A request retains its candidate, contract and next action; product questions retain explicit human ownership. Independent unaffected work continues. Both Spec and Standards verdicts bind to the exact reviewed scope/candidate.
4. **Acceptance evidence:** runner-owned command receipts and hashed immutable artifacts establish candidate/build/helper/platform provenance. Criterion disposition is separate from raw measurement. A model summary cannot invent an observed platform result. Reuse unchanged evidence only with explicit source/dependency identity. Child review, integration, parent acceptance and publication have separate completion states.
5. **Integration and delivery policy:** the existing uncommitted working-tree publication remains a supported policy. Saltwake uses explicit reviewed handoff/Lead integration and separately controlled artifact/preview promotion. Preserve accepted ancestry, selected refs, source/package manifests, user changes and project metadata. External publication can remain an explicit operator handoff until its adapter is qualified.
6. **Whole-team rehearsal and transfer:** exercise actual completion/rejection/decision wake-ups, conflicts, long commands, missing graphical evidence, interrupted tracker effects and duplicate results on disposable copies. Transfer uses a fresh paused manifest of roles, worktrees/dirty files, review pins, artifacts, processes and pending actions. Fence old dispatch before enabling the new coordinator; reconcile external effects before retry or rollback.

Each package records implementation and proof on its owning BRK-E12 story. Earlier transfer and runtime stories remain historical references. SQLite Library migration under BRK-E11 remains separately deferred.

## Qualification and release rules

- Existing workflows and pinned historical runs retain their behavior unless a new project policy is explicitly selected.
- Tests exercise public orchestration interfaces and meaningful failure/recovery cases. Disposable model and Rust proofs establish real execution separately from controlled-worker tests.
- The project reports capability by observed proof: implemented, locally tested, native-worker qualified, platform qualified, and transfer ready.
- Live Saltwake intake remains disabled until the complete rehearsal and a concrete final transfer review pass. Readiness work does not advance Saltwake PMT status, mutate its refs or close its apps.

## Evidence and decisions

- [Readiness assessment](http://localhost:4321/f/barracks/general/reports/2026-10-24-1845-saltwake-readiness) includes the direct Saltwake Lead consultation and code comparison.
- Headquarters `barracks/general/design/2026-10-22/cutover.md` retains whole-team transfer/fencing/rollback acceptance. Its historical runtime implementation choices are superseded by this repository's current state-machine runner.
- Barracks code is currently uncommitted with no HEAD. Review comparisons use `.state/saltwake-before`, captured before BRK-E12 implementation, rather than inventing a Git base.

## Implemented qualification

The qualified parent/ticket graph uses the existing runner rather than loading skill side effects. A ready ticket goes directly from Lead triage to its Builder. Missing readiness/evidence planning visits the BA. Shared-interface requests wake the configured Lead; affected source returns through separate Spec and Standards peers, Lead integration, acceptance and controlled publication.

- Separate canonical tracker roots and explicit frontiers are implemented. Source/tracker identity and project policy are pinned into each run. Functional scope changes invalidate intake; runner-owned status/history transitions do not.
- Per-command runtime budgets and case-insensitive environments are shared by build, review, integration and acceptance. Explicitly unlimited builds remain supervised and cancellable. Optional installed tools are hash-pinned and copied independently into each candidate's `.state/tools`; this qualifies Trunk without sharing a writable tool cache with workers.
- Fixed-team participant, path and host-resource leases are durable. Source and tracker authority locks span independent coordinator databases. A restarted coordinator reconciles saved owned jobs before resuming its new authority epoch.
- Explicit evidence planning covers every criterion. Actual exited/drained command receipts and copied artifacts are sealed by candidate. Passed native/browser observations require a recorded build and platform. Raw failures, bounded operator adjudications, explicit waivers and unverified checks retain different dispositions. Publication validates evidence again.
- `working-tree` publication preserves the existing uncommitted delivery behavior. `reviewed-branch` creates a scoped review ref and waits for verified Lead integration before canonical ticket completion. It preserves tracked metadata and initial dirty-source deletions; foreign Source edits hold delivery. Parallel intake currently supports `ref: HEAD`; select the intended worktree explicitly. Other ref values are rejected.
- Whole-team imports retain four role contexts, worktree patches/index/dirty bytes, ticket IDs, evidence, known process metadata and pending actions in a sealed paused manifest. Explicit original Builder ownership selects retained source; reviewer handoffs cannot change authorship. Approved adoption rechecks freshness and drain/fence evidence while canonical authority is held. Retained patches merge into private child workspaces, including conflict recovery, and preserve the original Builder. Durable assignment claims prevent replay into later reopened delivery. Prior review pins remain context for fresh current-candidate verification/reviews. Effect reconciliation reports subsequent source/tracker/index changes and preserves legitimate work.

Observed proofs:

| Proof | Evidence | Boundary |
|---|---|---|
| Actual four-role Codex delivery, two concurrent Rust capabilities, two review axes, Lead integration, acceptance/retro and final source/tracker publication | `.state/saltwake-team-proof/b510147c-3410-4d15-b982-706b4ed44960/result.json` | Disposable crate, not the active game team |
| Actual four-role Codex resumption from committed and dirty retained progress, preserving both Builder owners | `.state/saltwake-team-transfer-proof/e80ca3e5-1cb6-4831-925a-7fd81d8c98dc/result.json` | Old-team checkpoint/approval simulated in a disposable crate; resumed workers and compiler jobs real. Later adoption/consumption safeguards covered by focused regressions |
| Supervised command lasting 68.5 seconds, native Rust tests and Wasm library build | `.state/rust-command-proof/6de5eeb9-4c39-4801-ab72-ffb6377f530d/result.json` | Demonstrates execution beyond the old 60-second limit |
| Saltwake integration `011f8a54a96dc98cb1769c45472f11fb62be1e02`: actual native client and Wasm builds, domain tests and strict Wasm checks | `.state/saltwake-build-proof/407448d5-e7e3-44b0-9062-6d2d02b90e86/` and `.state/saltwake-profile-proof/ab9814bb-b7cb-4992-8e12-165de75a5570/result.json` | Independent archive and private compiler output; no live source or cache adoption |
| Actual SwiftShader Chromium HUD/header checks and inspected screenshots | `host-render-baa21f24-d628-4b63-bb0a-7fbfd104941c/result.json` beneath that build proof | Explicit standalone owned observer. Sandboxed Chromium timed out before rendering and remains unqualified. No automatic host permission was added to workflow verification |
| Four-role preliminary Saltwake inventory and dirty-work backups | `.state/transfers/a402d89e-f120-4a12-8a2e-c3cf979c9eef/manifest.json` | Explicit role/source-owner records; imported data is paused. Existing Saltwake dispatcher was not paused/fenced and activation is unapproved |

The Trunk packaging failure was reproduced and resolved through an explicit private copy of the installed wasm-bindgen binary. Its system-tool/cache selection is described in the [upstream tool adapter](https://github.com/trunk-rs/trunk/blob/main/src/tools.rs); the installed CLI help and actual disposable execution establish the local behavior. The initial artifact manifest used the wrong Cargo Wasm filename; the corrected result retains that failure and relies on the original successful owned-command receipts.

## Remaining live transfer gate

The staged profile is reviewable; it is not installed as a live Saltwake project. At the authorized checkpoint, obtain acknowledgements from all four existing roles, drain/fence old dispatch and reconcile actual process/cache ownership. Refresh the manifest against current heads, dirty work and scoped verdicts. Preserve reviewed existing capabilities and unresolved host drafts rather than treating an old commit or preparation PASS as current acceptance. Compare the paused dashboard/next-action import before activating a single new coordinator. Missing launch receipts or ambiguous ownership hold activation.

The existing Lead retains authority until that gate and explicit user approval. Draft PR530, hosted preview promotion, physical controller/mobile/macOS/performance checks and the retained backend waiver keep their existing boundaries. Automatic sandboxed browser qualification is not a readiness claim; platform acceptance can wait for an appropriate independently recorded observer result.

`scripts/saltwake-host-observer.ts <disposable-build-proof-folder> <task-uuid>` reproduces the explicit standalone observer after the disposable Trunk package exists. It owns a fresh loopback helper and Chrome profile, seals the actual build/helper/command evidence and closes only its own process tree. This operator command is separate from automatic workflow verification permissions.
