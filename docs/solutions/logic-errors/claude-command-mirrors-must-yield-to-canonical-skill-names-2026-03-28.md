# Claude command mirrors must yield to canonical skill names

## Problem

`ClaudeProjectSync` was still generating command mirrors into agent-native skill dirs even when the project already had a canonical skill with the same flattened name. That forced the sync to namespace around the canonical skill (`claude-google-forms`, then `claude-google-forms-2`, `-3`, `-4`, etc.), and the stale aliases leaked back into `.agents/rules` and `.agents/.skiller.json`.

## Fix

Build a canonical reserved-name set from `.agents/skills` plus explicit `localSkills`, then skip command/agent mirror generation when that base name is already owned canonically. Do the filtering per target, not globally: if the target is canonical `.agents/skills`, subtract that target's own managed Claude entries first so legacy managed items can still update or clean themselves instead of self-suppressing and getting deleted.

## Rule of thumb

Canonical skill ownership wins. If a command flattens to a name that already exists in `.agents/skills`, do not namespace it, do not mirror it, do not get clever. Skip it and let canonical propagation handle the target dirs.
