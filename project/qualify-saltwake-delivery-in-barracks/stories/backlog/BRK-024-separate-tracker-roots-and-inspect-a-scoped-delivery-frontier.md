---
schema_version: 4
type: story
id: BRK-024
epic: BRK-E12
title: Separate tracker roots and inspect a scoped delivery frontier
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

# Separate tracker roots and inspect a scoped delivery frontier

## Summary

Source and canonical PMT roots can differ. Inspect an explicitly selected frontier without writes, preserve IDs and original outcome counts, and pin eligible ticket scope/dependencies into runs.

## Acceptance Criteria

- Keep source and canonical PMT tracker roots separate; inspect existing trackers without initialization or mutation.
- Select and pin explicit delivery tickets, dependencies, label exclusions, ownership and scope fingerprints; retain omitted parent outcomes.
- Reject incompatible legacy workflow starts under restrictive project policy.
- Preserve pinned source/tracker/environment identity through child work, integration and historical output; hold changed scope or substituted paths.

## References

- [Target workflow and qualification plan](../../../../docs/saltwake-delivery.md)
- [Operational readiness assessment](http://localhost:4321/f/barracks/general/reports/2026-10-24-1845-saltwake-readiness)

## Questions

- No remaining questions.

## Plan

Follow package 1 in [Saltwake delivery readiness](../../../../docs/saltwake-delivery.md). Review against frozen pre-change source `.state/saltwake-before`; no committed HEAD exists.

Implemented source/tracker separation, explicit frontier preview/selection, YAML metadata parsing, label/rollup exclusions and immutable run/task/workspace project snapshots. Tests: delivery-frontier.test.ts, project-policy.test.ts and pinned-policy in parallel-source.test.ts. UI and isolated browser suite passed; policy/identity review findings fixed.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-24 | johns | Created | — | backlog | Initial story |

## Current implementation evidence

Implemented separate source/tracker settings, read-only scoped frontier previews, pinned scope/dependency/exclusion metadata, immutable project policy propagation and identity guards through child/integration/output paths. Meaningful frontier and substituted-directory regressions pass. Canonical tracker mutations now use staged/journaled effects rather than raw CLI retries.

See [implementation and proof boundaries](../../../../docs/saltwake-delivery.md). Story status remains unchanged for user review. BRK-E11 SQLite Library migration remains deferred.

Review: http://localhost:4321/f/barracks/general/reviews/2026-10-24-2238-qualified-saltwake-delivery


## Epic-first delivery, 2026-10-26

User requested selecting only the epic. Saltwake now uses epic selection; the compatible workflow/title default automatically and optional controls contain per-ticket selection. Intake derives unfinished eligible work and pins its scope, preserves label/rollup exclusions and strict explicit policy, and reports transitive outside-dependency deferrals. Missing initial ownership is planned read-only by Lead; Builder assignment and worker execution remain held until explicit grants exist. Existing/protected grants retain their checks. Canonical ticket scope is preserved. Deferred work stays outside the pinned run.

Evidence:119 full regressions,14 browser cases, three final focused cases after the reviewed workflow-kind correction, TypeScript/build and independent Spec/Standards pass. Actual Codex --epic Rust proof f5495b86-b897-4db9-8d4f-992090b019a5 completed with no ticketIds/prewritten grants (two capabilities, both reviews, native/Wasm and acceptance). Live form screenshot/preview verified27 eligible/188 deferred, zero blockers, zero Start requests. Source/story work remains uncommitted in Barracks; no new live Saltwake task. Runner30844 loaded changes with backups; eleven accepted todo-app hashes and user/game servers preserved. Review: http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Remove the remaining picker, 2026-10-26

User reported ticket selection was still requested. Epic-mode forms now omit all individual-ticket controls and clear stale subset state from the server-reported policy. Strict explicit-policy projects retain their controls. Board toolbar has Deliver selected epic directly from the Epic filter, with the existing draft guard; no ticket drawer is needed. Static responses use no-cache for fresh client reloads. Sixteen browser cases, frontier mode test, TypeScript and both independent reviews pass. Owned idle runner30844→91532 loaded the correction with backups; all11 accepted todo-app hashes and user/game servers preserved. No live delivery started. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Full ticket selection and dependency queue, 2026-10-26

User requested dependency-based Lead selection when choosing all tickets. Reproduced the old 100-ID schema ceiling against Saltwake’s 259-ticket epic, and strict-subset exclusions when all catalog IDs were supplied. Raised the bounded unique-ID limit to 1,000; full-catalog lists on epic-policy projects now normalize to epic intake. Explicit-policy validation remains strict. Completed/excluded work is omitted; unfinished external prerequisites defer work transitively. Existing dispatcher releases dependent tickets only after prerequisite integration. Reversed [C,B,A] lifecycle proof verified A/B files in C’s worktree before Lead triage. All13 frontier/lifecycle cases, TypeScript, build and independent Spec/Standards review passed. Live HTTP preview:259 IDs,27 eligible,188 deferred,zero blockers. Owned idle runner 91532 -> 54480;11 accepted todo-app hashes and user servers preserved. No live delivery started. User confirmed original error is no longer visible; exact message unverified. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Automatic review workflow routing, 2026-10-26

User supplied the exact error: Choose a ticket workflow with the required spec review stage. User expects Lead-owned coordination. Reproduced the exact message with paused disposable Factory intake using parallel-delivery on an epic-policy project requiring independent Spec/Standards review. Existing compatible UI default did not protect server intake from stale/incompatible parent choices. Added a shared compatible-graph predicate and server resolution for epic-policy public delivery choices, preserving compatible requested graphs, strict explicit selection, discovery/internal guards, concurrency, dependency gating and source authority. Effective workflow ID and routing reason are pinned with the run. Lead coordinates triage/delegation/integration; independent reviewers retain verdict ownership. Exact regression now passes. Six targeted tests, TypeScript, build and independent Spec/Standards review passed. Review found an invalid test fixture, corrected before final green run. Loaded runner 54480 -> 84240 with backup and all11 accepted todo-app source hashes preserved; user servers untouched. Actual Saltwake policy resolves parallel/sequential/qualified delivery to qualified-delivery and qualified-ticket; live default agrees, active runs0. No new Saltwake delivery started. This supersedes the prior note that the original error message was unknown. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Preserve the epic when changing workflow, 2026-10-26

User reported the epic was first, workflow appeared later and changing it required epic reselection. Both recommended/manual browser modes reproduced a blank epic. Consolidated workflow selection before the epic, keeping the compatible recommendation preselected; removed the explicit epic reset. Epic and custom title/description survive delivery changes and discovery/back. New-task reset and board epic preselection remain.21 browser cases passed; after independent Standards review corrected recommendation-copy visibility, both focused cases passed again. TypeScript/build and Spec/Standards reviews pass. Built client is served by existing runner84240; no restart or live delivery. Saved answers preserved. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Live monitoring and parent instruction handoff, 2026-10-26

Observed first epic run af17d366 correctly normalize workflow and queue SW-174/175 after complete SW-103. Lead recovered SW-174 missing pinned reference by locating original Saltwake commit73538aa9 and its source/docs/protocol fixtures; BA resumed without operator input. User stopped that run and started e2ef33b2-7bda-49db-9f7a-ab8523c791e7 with instructions to work from rust-refactor, leave main untouched, use separate worktrees and value maintainability. Old parent/children cancelled with no running assignments. New parent saved description but actual ticket Lead/BA prompts omit it. Prepared server/ticket-executors.ts fix appending persisted parent description at each worker dispatch; applies to existing children and retries, preserves scope/gates and full20KB parent input independently of10KB task-description limit. Regression red then green across seven role assignments including technical retry; six targeted cases and TypeScript pass; independent Spec/Standards reviews pass. NOT DEPLOYED. User has a pending asynchronous question to pause new assignments; no approval yet, no pause/restart/current-assignment edit performed. Snapshot 2026-10-26T13:05:19.529Z: SW-176 reached Builder then Lead technical/interface resolution; SW-193 with BA, no acceptance/integration. Source is rust-refactor at a2ed2b8; original main73538aa9 unchanged. Reviewed-branch publication remains separate; explicit target-branch-name enforcement is a recorded gap with ref HEAD. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Paused rollout and verified live instructions, 2026-10-26

User approved pause new assignments. Paused=true. Both previous BA/Lead owned process receipts confirmed drained. Loaded parent-instruction fix, plus response-schema correction (non-Builder interfaceRequest null) after both real replies were held by the existing role guard. Legitimate Lead authority blocker remains: macOS restart needs src/roster.rs outside delegation. Live recovery check found interrupted Lead state restored to implementing; corrected Store.resume/TicketExecutors to retain blocked technical-resolution context, pending question and spent limit1 budget, without granting paths or introducing automatic retry. Regression red/green;13 handoff/schema cases and11 final recovery/factory/ownership cases pass (overlap), TypeScript and independent reviews pass. Backed up DB/journal/configs, replaced owned runner84240->69340->82456 with all11 accepted todo-app hashes and user servers preserved. Reconciled the same parent under coordinator epoch7; controlled reservation of one BA proved actual prompt includes complete saved branch/main and maintainability instructions plus corrected schema. Paused again immediately; that BA may finish, no next worker starts. Live proof 2bc70662-ab0a-416c-9867-cf9db73240cd at 2026-10-26T13:31:02.831Z. SW-176 remains held for operator authority on src/roster.rs; none granted. Source rust-refactora2ed2b8 and original main73538aa9 unchanged. Supersedes prior prepared/not-loaded/pending-pause status. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Lead-owned routine source coordination adopted, 2026-10-26

User asked why routine src/roster.rs work required approval, adopted general Lead delegation and explicitly requested applying it to the same paused task. Added delivery.leadDelegation listed(default)/project. Project mode permits only Builder-requested relative paths with protected-overlap/unsafe-path rejection; existing concrete grants, writer locks and independent Spec/Standards/publication gates remain. Prompt and settings describe Lead ownership within approved ticket scope. A guarded paused/drained atomic adoption endpoint updates unfinished run/task snapshots and audits policy reason/previous attempt count. Only a request newly permitted by the policy receives one fresh Lead assessment; already-listed exhausted requests, protected blockers and completed history remain unchanged. Spec review found/reproduced/fixed the initial overbroad reassessment condition. Final15 backend cases include full qualified project-delegation delivery through independent reviews/integration/acceptance; separate actual generated prompt and browser cases, TypeScript/build and both review axes pass. Updated only Saltwake config leadDelegation for future runs; preserved all other settings. Backed up/restarted owned runner82456->9224 with global pause/no active workers. Live API adopted same run e2ef33b2-7bda-49db-9f7a-ab8523c791e7 at 2026-10-26T15:02:41.075Z, reacquiring coordinator ownership. Verified candidates, worktrees, original operator instructions, acceptance plans, actual grants and frontier unchanged; no path automatically granted. SW-176 now queued resolve_technical, technical attempts reset1->0 solely for changed delegation; SW-193 queued build. Root questions cleared, global paused=true, active assignments0: ready for operator Resume workflows. Source rust-refactora2ed2b8 and main73538aa9 unchanged; user/game servers and accepted todo-app hashes preserved. No live worker launched. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Epoch and retained-workspace policy recovery, 2026-10-26

User reported Project dispatch epoch is not owned by this coordinator after Resume. Root cause: Factory adoption reacquired epoch8 but Store reloaded savedparent7; added saveRun(parent) before adoption. New coordinator-replacement regression red then green through actual dispatch/reviews/integration/acceptance. First live retry fixed epoch9 but exposed cached workspace.json delegation overriding adopted task mode; both real workers requested old operator fileapproval. Paused again. prepare now overlays only adopted delegation after id/source/tracker/ref identity checks, retaining other frozen source facts. Actual cache-to-worker-prompt regression red/green and ref-change rejection pass. Shared policy text supports scoped amendments preserving earlier product decisions. Final15 tests, TypeScript/build and both independent reviews pass. One-time native repair required stopped ownedPID, global pause/noactiveassignments, exact expectedparent/children states, unchanged baseline inventories/candidates/grants/worktrees; rollback dryrun then audited apply. Restored SW-176’s original accepted Builder request from saved before-adoption snapshot and fresh budget solely for erroneous oldpolicy run; SW-193 queued with scoped amendment. Source files unchanged by repair. Owned runner9224->43840->51672 with backups and accepted todo-app hashes/user servers preserved. Same parent e2ef33b2-7bda-49db-9f7a-ab8523c791e7 resumed under matching epoch10; both actual prompts contain current delegation, amendment and original instructions. Real Lead approved src/roster.rs, SW-176 moved to implementation. At 2026-10-26T15:36:45.4435272Z SW-176 Builder and SW-193 Lead active, pausedfalse, no recovery/humanquestions. Source rust-refactora2ed2b8 and main73538aa9 unchanged. Earlier ready-only checkpoint superseded; full implementation/review/acceptance/integration remains pending. http://localhost:4321/f/barracks/stories/BRK-024/reviews/2026-10-26-0007-select-epic-delivery


### Work History: user-authorized cancellation and manual return, 2026-10-26

Cancelled parent e2ef33b2-7bda-49db-9f7a-ab8523c791e7 and both children; earlier cancelled epic and complete SW-352 trial retained. Global dispatch paused, zero active assignments, 51 owned process receipts drained, Source/tracker locks released. Source rust-refactor a2ed2b8 and main73538aa9 unchanged. Archived pre/post snapshots, manifests, hashes and SW-176 inspection note under .state/saltwake-return-20261026-154833; return-audit.json passed. Canonical pickup: C:/Users/johns/.headquarters/saltwake/general/handoffs/2026-10-26-1153-barracks-return-manual.md. Existing Saltwake Lead receives manual coordination; four unfinished ticket statuses require its reconciliation. Story status unchanged; this operational shutdown supplies no new game acceptance.
