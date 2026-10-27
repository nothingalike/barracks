---
name: factory-review
description: Review a Factory pull-request candidate internally under Barracks review and publication rules.
---

# Barracks review

Load `barracks-team` and `barracks-builder`. Require a current review binding and verify that the assigned reviewer is not the author. Inspect the full current candidate against the story, repository standards and actual test evidence.

Return the exact reviewed SHA, confirmed findings, check results and qualification limits to the Lead, BA and author through the internal handoff surface. Keep specification and technical verdicts separate. Use an internal Factory verdict only for the current candidate and supported outcome.

Source-system comments, approvals, labels and resolutions need the user's explicit authorization for that action. Prepare the findings for the user when publication is not authorized.
