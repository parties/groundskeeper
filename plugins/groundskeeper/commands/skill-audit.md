---
description: Scan skill usage and report cold/unused, kept, and snoozed skills (read-only)
---

Read-only skill-usage scan using groundskeeper. (To actually prune, use `/skill-cleanup`.)

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.js" report` and parse the JSON.
2. Present:
   - One-line summary: `total` skills, `hot_count` hot, `cold_count` cold, `suppressed_count` suppressed. Note the active window from `config` (e.g. "cold = `cold_days`d unused, `grace_days`d grace").
   - A table of **cold personal skills** (`personal_cold`): name, last used ("never" when null), days cold, uses. These are removal candidates — point the user to `/skill-cleanup` to act.
   - If `plugin_cold` is non-empty: a short note (stats only — plugin skills aren't individually removable).
   - If `plugins_fully_cold` is non-empty: note each plugin whose skills are ALL cold; suggest disabling that whole plugin in plugin settings.
   - If `suppressed` is non-empty: list kept/snoozed skills (with snooze `until` date) so the user sees what's being hidden from cold reports.
3. This command does not modify anything. Mention the available actions:
   - `/skill-cleanup` — interactively disable cold skills.
   - Snooze/keep: `audit.js snooze <skill> [days]`, `audit.js keep <skill>` (and `unsnooze`/`unkeep`).
   - Thresholds: `audit.js config set <cold_days|grace_days|nudge_days|snooze_days> <n>`.
   - Restore a disabled skill: `audit.js restore <skill>`.
