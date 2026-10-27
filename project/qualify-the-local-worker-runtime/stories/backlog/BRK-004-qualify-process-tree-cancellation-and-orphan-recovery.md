---
schema_version: 4
type: story
id: BRK-004
epic: BRK-E01
title: Qualify process-tree cancellation and orphan recovery
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-002"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-23
updated_at: 2026-10-23
---

# Qualify process-tree cancellation and orphan recovery

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Prove cancellation and orphan reconciliation using owned process identity while preserving dirty source and unrelated user processes.

## Acceptance Criteria

- [ ] Identify owned jobs by PID, start time and job identity.
- [ ] Cancel a real owned descendant tree and verify the observed exit state.
- [ ] Reconcile a surviving worker after coordinator failure without a second writer.
- [ ] Preserve tracked patches, untracked files and evidence; leave unrelated processes intact.

## References

- [Delivery plan](../../../../archive/2026-10-22/prototype/docs/implementation/delivery-plan.md).
- Approved architecture and cutover: Headquarters barracks/general/design/2026-10-22.
- [Runtime evidence](../../../../archive/2026-10-22/prototype/docs/implementation/runtime-qualification.md).

## Questions

- Qualification results govern implementation choices. Remaining failures are recorded as explicit limits.

## Plan

### Architecture

Use the qualification layer in `src/qualification/`; keep liveDispatch=false and record results under ignored `.barracks/`.

### Models

Qualification payloads carry a marker, phase and explicit provider session ID. Production workerResult retains exact source SHAs, evidence hashes, attempt and requested next action.

### Workflow

1. Inspect current source and exact tool versions.
2. Run this story's disposable qualification cases and preserve evidence.
3. Record observed results and limits here before dependent implementation.

## Evidence

Qualification pending. Existing probes terminate only their direct child; they do not satisfy this story.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

| 2026-10-23 | Maintainer | Plan recorded | backlog | backlog | Accepted P01 scope split into bounded qualification stories; status unchanged. |

## Continuation evidence, 2026-10-22

Owned Job Object explicit cancellation and abrupt-host-loss fixture cases PASS. Root, child and detached grandchild exit; explicit cancellation also verifies console helpers and zero Job Object members. Unrelated sentinel survives and representative source bytes are preserved. Coordinator-loss trials did not establish usable independent startup and remain UNQUALIFIED. Evidence .barracks/process/2d6489d5-f246-4e84-aed8-4cc9bbfb38df/result.json; details docs/implementation/windows-qualification.md.

Status remains backlog; observed partial evidence does not complete P01.

