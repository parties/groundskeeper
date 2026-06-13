#!/usr/bin/env node
'use strict';
// groundskeeper SessionStart nudge. At most ONE line, capped to once per nudge_days.
const { paths, report, readState, writeState, readConfig, nowS } = require('./lib');

const P = paths();
const now = nowS();
const cap = readConfig(P).nudge_days * 86400;
const state = readState(P);
const last = typeof state.last_nudge === 'number' ? state.last_nudge : 0;

// bail cheaply if nudged within the cap window
if (now - last < cap) process.exit(0);

let rep;
try { rep = report(P); } catch { process.exit(0); }

// stamp regardless, so we scan at most once per window
state.last_nudge = now;
try { writeState(P, state); } catch {}

const n = rep.personal_cold.length;
if (n >= 1) {
  process.stdout.write(`\u{1F9F9} groundskeeper: ${n} personal skill(s) cold ${rep.config.cold_days}d+. Run /skill-cleanup to review.\n`);
}
process.exit(0);
