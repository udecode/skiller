# Claude plugin migration command plan

## Goal

Add a one-shot migration command that reads legacy Claude plugin config and installs the equivalent repos through `skills`, without reintroducing plugin sync into `apply`.

## Constraints

- Keep `apply` strict: fail on legacy Claude plugin state.
- No URL normalization tricks; install sources should be explicit repo slugs or Git URLs.
- Migration command may read `.claude/settings.json` and legacy manifest/plugin metadata.
- User still removes plugin entries manually after migration.

## TDD slices

1. Add failing CLI/integration tests for `skiller migrate claude-plugins` dry-run output and execution behavior.
2. Implement plugin repo discovery from `.claude/settings.json` marketplace metadata and/or legacy manifests.
3. Execute `skills add <repo> --agent universal --skill '*' -y` once per unique repo.
4. Print unresolved plugins clearly when repo source cannot be inferred.
5. Update help/docs and keep `apply` rejection path unchanged.
