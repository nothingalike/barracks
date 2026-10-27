---
schema_version: 4
type: story
id: BRK-003
epic: BRK-E01
title: Qualify worker write isolation and protected refs
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

# Qualify worker write isolation and protected refs

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Prove that worker writes cannot mutate canonical checkouts or common protected refs, including through alternate shells.

## Acceptance Criteria

- [ ] Use disposable repositories with before/after byte and ref hashes.
- [ ] Exercise allowed fixture writes and refused canonical checkout/common-ref mutations.
- [ ] Treat prompt rules and input schemas as configuration, with actual OS or sandbox enforcement required.
- [ ] If CLI isolation cannot enforce the boundary, retain an explicit activation blocker for restricted-account or sandbox qualification.

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

Qualification pending; no isolation claim or live write authority.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

| 2026-10-23 | Maintainer | Plan recorded | backlog | backlog | Accepted P01 scope split into bounded qualification stories; status unchanged. |

## Continuation evidence, 2026-10-22

Read-only Codex control BLOCKED before execution: helper_unknown_error: setup refresh had errors. npm run qualify:isolation-control exits 2; evidence .barracks/isolation/52da4845-db54-444f-a129-21a31413db46/result.json. Native Windows Claude commands are unsandboxed per official provider docs. Canonical/ref isolation remains unqualified; no sandbox configuration or user processes changed.

Status remains backlog; observed partial evidence does not complete P01.

