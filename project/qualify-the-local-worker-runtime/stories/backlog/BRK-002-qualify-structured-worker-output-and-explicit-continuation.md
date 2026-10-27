---
schema_version: 4
type: story
id: BRK-002
epic: BRK-E01
title: Qualify structured worker output and explicit continuation
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

# Qualify structured worker output and explicit continuation

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Prove authenticated structured output and explicit-session continuation for installed CLI workers in disposable fixtures, before choosing the broker protocol.

## Acceptance Criteria

- [ ] Verify flags against installed help and official provider documentation.
- [ ] Validate structured output, terminal success and explicit session identity; missing output or an error cannot pass.
- [ ] Resume the exact captured session and recall a marker omitted from the second prompt.
- [ ] Bound each experiment and record authentication or approval failures without publishing credentials.
- [ ] Keep results scoped to the tested CLI, options and fixture; live dispatch stays disabled.

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

Added opt-in protocol experiment and parser tests. Actual provider outcomes will be appended after execution.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

| 2026-10-23 | Maintainer | Plan recorded | backlog | backlog | Accepted P01 scope split into bounded qualification stories; status unchanged. |

## Protocol results

2026-10-22 local: both authenticated marker/schema experiments PASS with exact-session continuation. Codex evidence: .barracks/protocol/codex-1b537899-d985-4919-a5dc-00c5071b00d7/. Claude evidence: .barracks/protocol/claude-be6bba30-e608-4d3f-bb2d-d96aa013c738/. TypeScript and 10 focused tests PASS. Initial harness failures and corrections are recorded in docs/implementation/runtime-qualification.md. Production handoff semantics, configured role/model execution, enforced write isolation, cancellation and Windows behavior remain unqualified. Status stays backlog; no team assignment or migration occurred.

