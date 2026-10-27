---
schema_version: 4
type: story
id: BRK-005
epic: BRK-E01
title: Qualify Windows user-session and storage behavior
status: backlog
priority: normal
milestone: null
assignees: []
labels: []
depends_on: ["BRK-001"]
adrs: []
reviews: []
github:
  issue: null
  pull_requests: []
created_at: 2026-10-23
updated_at: 2026-10-23
---

# Qualify Windows user-session and storage behavior

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Qualify local storage and interactive Windows user-session behavior before relying on a persistent desktop-test host.

## Acceptance Criteria

- [ ] Use absolute storage paths and a single storage owner; record shutdown and restart behavior.
- [ ] Observe desktop access in a usable signed-in session and report unavailable or locked-session behavior truthfully.
- [ ] Observe sleep/restart and child-lifetime behavior before claiming reliable unattended execution.
- [ ] Keep desktop/client lifetime separate from the intended runner lifetime; activation remains gated on later rehearsal.

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

Partial storage evidence exists from version workflow; user-session, sleep/restart and descendant lifetime remain unqualified.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

| 2026-10-23 | Maintainer | Plan recorded | backlog | backlog | Accepted P01 scope split into bounded qualification stories; status unchanged. |

