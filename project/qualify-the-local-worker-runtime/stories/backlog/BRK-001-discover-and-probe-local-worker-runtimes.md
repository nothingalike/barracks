---
schema_version: 4
type: story
id: BRK-001
epic: BRK-E01
title: Discover and probe local worker runtimes
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
created_at: 2026-10-23
updated_at: 2026-10-23
---

# Discover and probe local worker runtimes

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Identify the installed Node, Codex and Claude entry points and prove the local Mastra/libSQL workflow can persist a version-only run.

## Acceptance Criteria

- [ ] Qualification always runs with liveDispatch=false.
- [ ] Record exact CLI versions and real subprocess exit/error, timeout and output-limit behavior.
- [ ] Run TypeScript checks, the focused suite and a real Mastra/libSQL workflow; distinguish version probes from authenticated jobs.

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

Existing implementation inspected. npm run check PASS; npm test 7/7 PASS; npm run qualify PASS at 2026-10-23T01:08:03.319Z, run 93515cb8-efc6-4172-9f16-627dd305c674.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |

| 2026-10-23 | Maintainer | Plan recorded | backlog | backlog | Accepted P01 scope split into bounded qualification stories; status unchanged. |

