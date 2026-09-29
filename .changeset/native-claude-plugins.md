---
'skiller': patch
---

Keep Claude plugins that a project enables natively. `skiller apply` no longer refuses when `.claude/settings.json` lists `enabledPlugins`; it refuses only when skiller's own manifest still carries legacy plugin entries.
