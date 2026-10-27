---
name: factory-self-review
description: Review a pre-PR candidate using Barracks independent Builder and BA evidence requirements.
---

# Barracks candidate review

Load `barracks-team` and `barracks-builder`. Use the current Factory review binding and exact candidate SHA. Check author identity; an author records a self-check rather than independent acceptance and requests the other Builder slot.

Inspect the diff, relevant consumers, repository standards and BA acceptance evidence. Run applicable independent checks. Report confirmed findings and limits internally. BA specification acceptance and this technical review must cover the same current candidate before acceptance.

Use the available internal Factory verdict tool only when its scope matches the evidence. Include reviewed SHA, checks and findings. When evidence is incomplete, report that state and the requested next action. Leave commits, pushes and PR publication to the user's authorized workflow.
