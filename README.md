# groundskeeper

Skill-usage tracking and cleanup for Claude Code.

You install skills and plugins, and your skill set quietly grows — most of them you never touch again. `groundskeeper` watches which skills you actually invoke, flags the ones that have gone **cold**, and helps you reversibly prune the unused personal ones. Configurable thresholds, keep/snooze when you want to silence a skill, and an interactive cleanup that asks before it touches anything.

No prompts during normal work, no measurable token cost: a background hook appends one line per skill use, and a once-a-week nudge only speaks up when something's actually gone cold.

## Zero dependencies

Pure Node.js (`fs`/`path`/`os` only). `node` ships with Claude Code, so there's nothing to install — no `jq`, no `bash`, no bundled binaries. Runs natively on **macOS, Linux, and Windows**.

## Install

```
/plugin marketplace add zvoque/groundskeeper
/plugin install groundskeeper@groundskeeper
```

Restart the session so the hooks load. Usage logs immediately; cold flags appear after the grace + cold window.

## How it works

- A `PostToolUse` hook matched to the `Skill` tool appends one line to `~/.claude/groundskeeper/usage.jsonl` every time a skill runs — **0 model tokens**, fires only on skill use.
- A `SessionStart` hook prints at most **one reminder line, at most once per `nudge_days`** (default 7), and only if non-suppressed cold skills exist (~20 tokens/week).
- `/skill-audit` scans and reports. `/skill-cleanup` interactively prunes.

### "Cold" definition (configurable)

A skill is cold when it hasn't been invoked in **`cold_days`** (default **45**), ignoring any skill first seen less than **`grace_days`** (default 14) ago. Never-used skills are measured idle from when tracking began, so a fresh install flags nothing until it has observed for the cold window.

### Keep & snooze

- **keep** — permanently exclude a skill you use rarely but want to keep.
- **snooze** — temporarily exclude for N days (default `snooze_days`, 30).

Kept and snoozed skills never appear in cold reports or nudges.

### Removal is reversible

Disabling **moves** a skill to `~/.claude/skills-disabled/<name>/` with a restore note. Nothing is deleted; restore anytime. Only **personal** skills (`~/.claude/skills`) are removable — plugin skills are reported on (and a fully-cold plugin is flagged), but never individually deleted.

## Commands

- **`/skill-audit`** — read-only scan: hot/cold/suppressed counts, the cold-skill table, and the active config window.
- **`/skill-cleanup`** — interactive prune. Asks whether to disable **all** cold skills, **choose** specific ones, or **snooze/keep** instead — and never acts without your selection.

Both are thin wrappers over `plugins/groundskeeper/scripts/audit.js`, which you can also run directly:

| `audit.js <cmd>` | Action |
|---|---|
| `report` | JSON usage report |
| `disable <name>...` / `restore <name>...` | reversibly disable / restore personal skills |
| `list-disabled` | list disabled skills |
| `config` / `config set <key> <val>` | get/set thresholds (`cold_days`, `grace_days`, `nudge_days`, `snooze_days`) |
| `keep` / `unkeep <name>...` | permanent suppression |
| `snooze <name> [days]` / `unsnooze <name>...` | temporary suppression |

## Data

Stored under `~/.claude/groundskeeper/` (survives plugin updates):

- `usage.jsonl` — append-only log (skill name + timestamp only; no prompt content).
- `config.json` — thresholds.
- `state.json` — last-nudge time, disabled registry, kept list, snoozed list.
- `~/.claude/skills-disabled/` — disabled-skill graveyard.

## Limitations

- Tracks personal + plugin skills only. Project-scoped skills (`./.claude/skills`) are not tracked.
- No transcript backfill — the log starts fresh on install.

## Development

```
git clone https://github.com/zvoque/groundskeeper
cd groundskeeper
node tests/run.js
```

Local install for development (instead of the marketplace add above):

```
/plugin marketplace add /path/to/groundskeeper
/plugin install groundskeeper@groundskeeper
```

## License

MIT
