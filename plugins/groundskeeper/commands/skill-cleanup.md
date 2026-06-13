---
description: Interactively clean up cold/unused skills — disable all, choose some, or snooze/keep
---

Interactive cleanup of cold skills using groundskeeper.

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.js" report` and parse the JSON.
2. If `personal_cold` is empty: tell the user there's nothing to clean (mention `cold_count`, `suppressed_count`, and the active `config.cold_days` window) and stop.
3. Otherwise use the **AskUserQuestion** tool. First question — "`<N>` personal skills are cold (≥`<config.cold_days>`d unused). How do you want to clean up?" with options:
   - **Disable all `<N>`** — prune every cold personal skill.
   - **Choose which** — pick specific skills.
   - **Snooze / keep instead** — suppress without disabling.
   - **Cancel** — do nothing.
4. **Disable all** → for each skill in `personal_cold`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.js" disable <skill>`. Report results.
5. **Choose which** → use AskUserQuestion with `multiSelect: true`, one option per cold skill (label = skill name; description = `last used <last_used>, <days_cold>d cold, <uses> uses`). For each selected skill run `audit.js disable <skill>`.
6. **Snooze / keep instead** → use AskUserQuestion (`multiSelect: true`) to pick skills, then ask keep vs snooze:
   - keep (permanent): `audit.js keep <skill>`
   - snooze (temporary): `audit.js snooze <skill> [days]` (omit days to use the configured default)
7. Always remind the user: disables are reversible with `audit.js restore <skill>`; kept/snoozed skills no longer appear in cold reports or nudges.

Rules:
- NEVER disable, keep, or snooze a skill without an explicit selection from the user.
- Only personal skills are disable-able. Plugin skills are report-only (if a whole plugin is cold, suggest the user disable that plugin in their plugin settings).
- To change thresholds: `audit.js config set cold_days <n>` (also `grace_days`, `nudge_days`, `snooze_days`).
