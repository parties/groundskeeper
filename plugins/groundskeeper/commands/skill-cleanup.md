---
description: Interactively clean up cold/unused skills — disable all, choose some, or snooze/keep
---

Interactive cleanup of cold skills using groundskeeper.

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.js" report` and parse the JSON.
2. If `personal_cold` is empty: tell the user there's nothing to clean (mention `cold_count`, `suppressed_count`, and the active `config.cold_days` window) and stop.
3. Check `personal_cold_removable`. If it is `0`, every cold skill is report-only (see the `removable` rule below): say so, list them, explain that pruning has to happen in the repo that owns each one, offer keep/snooze, and stop — do not offer a disable.
4. Otherwise use the **AskUserQuestion** tool. First question — "`<personal_cold_removable>` personal skills are cold (≥`<config.cold_days>`d unused) and can be disabled. How do you want to clean up?" with options:
   - **Disable all `<N>`** — prune every cold personal skill.
   - **Choose which** — pick specific skills.
   - **Snooze / keep instead** — suppress without disabling.
   - **Cancel** — do nothing.
5. **Disable all** → for each skill in `personal_cold` **with `removable: true`**, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.js" disable <skill>`. Report results.
6. **Choose which** → use AskUserQuestion with `multiSelect: true`, one option per cold skill **with `removable: true`** (label = skill name; description = `last used <last_used>, <days_cold>d cold, <uses> uses`). For each selected skill run `audit.js disable <skill>`.
7. **Snooze / keep instead** → use AskUserQuestion (`multiSelect: true`) to pick skills, then ask keep vs snooze:
   - keep (permanent): `audit.js keep <skill>`
   - snooze (temporary): `audit.js snooze <skill> [days]` (omit days to use the configured default)
8. Always remind the user: disables are reversible with `audit.js restore <skill>`; kept/snoozed skills no longer appear in cold reports or nudges.

Rules:
- NEVER disable, keep, or snooze a skill without an explicit selection from the user.
- Only rows with `removable: true` are disable-able. A cold skill is report-only when it is a plugin skill, a library skill (key `<library>:<skill>`), or a personal skill that is symlinked in from another repo — disabling any of those would move a directory the owning repo tracks, so `audit.js disable` refuses it. Tell the user where it actually lives and let them prune it there.
- If a whole plugin is cold (`plugins_fully_cold`), suggest disabling that plugin in their plugin settings.
- Keep and snooze work on **every** skill, removable or not — they are the only actions available for report-only rows.
- To change thresholds: `audit.js config set cold_days <n>` (also `grace_days`, `nudge_days`, `snooze_days`).
