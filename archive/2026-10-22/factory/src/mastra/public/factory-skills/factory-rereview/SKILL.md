---
name: factory-rereview
description: Recheck changed Factory candidates against previous Barracks findings and the current exact revision.
---

# Barracks rereview

Load `barracks-team`, `barracks-builder` and `factory-review`. Confirm the live review binding, non-author reviewer identity and new candidate SHA. Reconcile every previous finding against the new source, then inspect new changes and affected consumers for regressions.

Rerun checks affected by the change. Record which verdicts remain applicable and which need refresh. Return a current internal verdict with full source identity, evidence and remaining findings. Publish externally only under the user's authorization for that specific action.
