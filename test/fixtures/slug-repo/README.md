# Disposable slug utility

Implement `slugify(string)` in `slug.mjs`: lowercase ASCII letters, replace each run of non-alphanumeric characters with one hyphen, and trim leading/trailing hyphens. Empty or punctuation-only input produces an empty string.

Run checks with `node --test`. Dependencies and network access are unnecessary.

The first implementation assignment changes only `slug.mjs`. A dedicated Reviewer then checks the implementation and requires a separate `slug.edge.test.mjs` regression case for `  A___B---C  ` producing `a-b-c`. The subsequent Builder assignment may add that regression file. This intentionally staged coverage requirement exercises the review/fix handoff without fabricating a review verdict.
