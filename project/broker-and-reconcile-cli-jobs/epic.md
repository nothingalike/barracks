---
schema_version: 1
type: epic
id: "BRK-E03"
title: "Broker and reconcile CLI jobs"
slug: "broker-and-reconcile-cli-jobs"
status: planned
owners: []
labels: []
created_at: "2026-10-23"
updated_at: "2026-10-23"
---

# Broker and reconcile CLI jobs

> Historical planning (2026-10-22): reassess this earlier implementation item against [the current state-machine direction](../../docs/current-direction.md) before assignment. Existing ID and status are preserved.

## Summary

P03: one job per key, process identity, preserved work and crash reconciliation.

## Goals

- One job per key, PID/start identity, preserved dirty work and crash/orphan proof without duplicate writers.

## Non-Goals

- Live Saltwake transfer begins only after P08 rehearsal and P09 exclusive-ownership gates.

## Success Measures

- Record actual results, exact source identities and remaining limits in reviewed evidence.

## References

- [Delivery order and dependencies](../../docs/implementation/delivery-plan.md).

## Questions

- Refine bounded stories from qualified predecessor interfaces before assignment.

## Work Items

[View this epic's generated work-item index](epic-index.md).

## Work History

| Date | Actor | Action | From | To | Notes |
|---|---|---|---|---|---|
| 2026-10-23 | johns | Created | — | planned | Initial epic |

