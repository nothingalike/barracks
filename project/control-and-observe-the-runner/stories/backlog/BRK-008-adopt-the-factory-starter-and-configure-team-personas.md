---
schema_version: 4
type: story
id: BRK-008
epic: BRK-E07
title: Adopt the Factory starter and configure team personas
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

# Adopt the Factory starter and configure team personas

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

Use the official Mastra Factory runtime and built-in boards with Barracks persona and lifecycle instructions.

## Acceptance Criteria

- [x] Use the official Factory starter for server, UI, boards, sessions and dispatch.
- [x] Load shared team, Lead, BA and Builder persona instructions through Factory's supported local skill source.
- [x] Override lifecycle instructions locally while retaining built-in boards and transitions.
- [x] Run on loopback without Mastra Platform sign-in, preserving credential encryption.
- [x] Keep local database, sandbox paths, credentials and generated UI outside version control.
- [ ] Verify a real model-backed session applies the personas in a disposable repository.
- [ ] Verify role capacity and non-author peer-review identity before production intake.

## References

- [Configuration and limits](../../../../archive/2026-10-22/factory/BARRACKS.md).
- [Run commands and team mapping](../../../../README.md).
- [Official starter](https://github.com/mastra-ai/softwarefactory-template).
- [Authentication configuration](https://factory.mastra.ai/configure/auth).

## Questions

- Model provider and disposable repository connection remain operator setup steps.
- Runtime role-slot enforcement, protected-source isolation and production worker behavior remain unqualified.

## Plan

### Architecture

Use create-factory 0.3.0 with no platform provisioning; configure the installed Factory 0.24.0 through its entrypoint and public skills. Preserve earlier prototype code outside the application's imports. The user adopted this approach and selected local-only access.

### Models

Fixed configured roster: one Lead, one BA, Builder A and Builder B. Peer review occupies an existing Builder slot. PMT owns scope/status; Headquarters owns decisions/evidence; Factory owns execution progress. Persona instructions express responsibilities; the two-task background dispatch budget does not enforce per-role capacity.

### Workflow

1. Start the pinned Node 22.23.3 app through the root launcher.
2. Create or preserve ignored local storage and encryption configuration.
3. Supply a development-only local operator through the supported SimpleAuth seam; bind to loopback and reject foreign origins/cross-site browser requests. The bundled web UI refuses auth:null, so disabling auth alone does not provide usable browser access.
4. Load ten local persona/lifecycle skills; verify selection through the installed FactorySkillSource.
5. Connect a model provider and disposable repository, then qualify real worker behavior before enabling production intake.

## Evidence

2026-10-22 local: source typecheck PASS; ten skills selected by the installed Factory source PASS; local access checks PASS for loopback acceptance, foreign-origin/cross-site rejection and production guard. Final build PASS; browser opens directly to Set up your factory without Mastra Platform sign-in. Generated UI is excluded from source typechecking and Git. Browser verification and final build are recorded in the Headquarters review. No model job or Saltwake transfer has run. Status remains backlog/unassigned; all changes are uncommitted.

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | backlog | Initial story |



