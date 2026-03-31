---
date: 2026-03-30
topic: simple-preset-includes
---

# Simple Preset Includes

## Goal

Teach `skiller install <source> --preset <name>` to reuse selected repo-root files without duplicating them inside the preset directory.

## Plan

- [completed] Update preset config/types to support optional preset `include` paths rooted at the preset and resolving into supported target roots.
- [completed] Update `PresetInstaller` to materialize included paths first, then overlay preset-local files.
- [completed] Add integration coverage for include behavior, preset-local override behavior, and lockfile sharing.
- [completed] Update docs for the simpler preset model.
- [completed] Run typecheck, lint, and targeted tests.

## Notes

- No `source_root`.
- No arbitrary path remapping.
- `skills-lock.json` and `skiller-lock.json` should be includable and then flow through existing install behavior.
- Preset config lives at `preset.toml`.
- Included paths resolve relative to `preset.toml`; target paths are derived from the first supported root marker instead of a manual remap table.
- Includes are file-only on purpose. No directory expansion.
