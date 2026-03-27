# Hard-Cut Skills Catalog Plan

## Goal

Replace `skiller`'s hand-maintained agent catalog with a vendored snapshot from the canonical `skills` package and hard-cut to canonical agent identifiers only.

## Steps

1. Add a pinned `skills` package dependency and inspect its published internals.
2. Add a refresh script that generates a vendored agent catalog snapshot from the installed `skills` package.
3. Rewire `skiller` to read supported agent metadata from the snapshot and rename adapter identifiers to canonical ids.
4. Remove public support for agents not present in `skills`.
5. Update CLI, config normalization, docs, and tests to fail hard on old ids.
6. Run focused verification and fix fallout.

## Notes

- No backward compatibility.
- No `npx skills update` during `skiller apply`.
- Runtime must stay offline and deterministic.
